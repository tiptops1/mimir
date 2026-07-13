import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { quotaSnapshot, seedQuotas } from "../../src/lib/leadone/quota";
import { runSource } from "./source";
import { runEnrichWebsite } from "./enrich-website";
import { runEnrichContact } from "./enrich-contact";
import { runValidate } from "./validate";
import { runVerifyLinkedin } from "./verify-linkedin";

// Lead One orchestrator — the single entry point GitHub Actions runs daily.
// Stages run sequentially under one global time budget (LEADONE_MAX_MINUTES,
// default 35); each stage catches its own errors so one failure never kills
// the run, and quota exhaustion is a normal outcome (exit 0) — the next run
// resumes when the free tiers refresh.
//
// Usage: npx tsx scripts/leadone/run.ts        (LEADONE_MAX_MINUTES to tune)

const PURGE_REJECTED_DAYS = 90;
const PURGE_PROMOTED_DAYS = 30;
// Backpressure: don't burn search quota widening a crawl backlog we can't
// keep up with — the monthly search budget is better spent once the backlog drains.
const MAX_CRAWL_BACKLOG = 500;

async function main() {
  const prisma = new PrismaClient();
  const minutes = Number(process.env.LEADONE_MAX_MINUTES ?? "35");
  const deadline = Date.now() + minutes * 60_000;
  const trigger = process.env.GITHUB_EVENT_NAME === "schedule" ? "CRON" : "MANUAL";

  const run = await prisma.leadOneRun.create({ data: { trigger } });
  const stats: Record<string, unknown> = {};
  const errors: string[] = [];

  try {
    await seedQuotas(prisma);

    // Housekeeping: keep the staging collection small (Atlas M0 = 512 MB).
    const now = Date.now();
    const purged = await prisma.leadCandidate.deleteMany({
      where: {
        OR: [
          {
            status: "REJECTED",
            updatedAt: { lt: new Date(now - PURGE_REJECTED_DAYS * 86400000) },
          },
          {
            status: "PROMOTED",
            updatedAt: { lt: new Date(now - PURGE_PROMOTED_DAYS * 86400000) },
          },
        ],
      },
    });
    stats.purged = purged.count;

    // 1) Sourcing (fast, free) — cap per run, leave time for enrichment.
    try {
      stats.source = await runSource(prisma, {
        max: 5000,
        deadline: Math.min(deadline, Date.now() + 8 * 60_000),
      });
    } catch (e) {
      errors.push(`source: ${(e as Error).message}`);
    }

    // 2) Website discovery (quota-gated) — skipped under crawl backpressure.
    const backlog = await prisma.leadCandidate.count({
      where: { status: "ENRICHED_WEBSITE" },
    });
    if (backlog > MAX_CRAWL_BACKLOG) {
      stats.website = { skipped: true, backlog };
      console.log(`Skipping website stage — crawl backlog at ${backlog}.`);
    } else {
      try {
        stats.website = await runEnrichWebsite(prisma, { deadline });
      } catch (e) {
        errors.push(`website: ${(e as Error).message}`);
      }
    }

    // 3) Crawl for email/phone/speciality — gets the remaining time budget.
    try {
      stats.contact = await runEnrichContact(prisma, { deadline });
    } catch (e) {
      errors.push(`contact: ${(e as Error).message}`);
    }

    // 4) Validation & scoring (fast).
    try {
      stats.validate = await runValidate(prisma, { deadline });
    } catch (e) {
      errors.push(`validate: ${(e as Error).message}`);
    }

    // 5) LinkedIn verification for the review queue (serpapi.com, 250/month).
    try {
      stats.linkedin = await runVerifyLinkedin(prisma, { deadline });
    } catch (e) {
      errors.push(`linkedin: ${(e as Error).message}`);
    }

    stats.quota = await quotaSnapshot(prisma);
  } finally {
    await prisma.leadOneRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        stats: stats as Prisma.InputJsonValue,
        error: errors.length ? errors.join(" | ") : null,
      },
    });
    console.log("\nRun summary:", JSON.stringify(stats, null, 2));
    if (errors.length) console.error("Stage errors:", errors.join(" | "));
    await prisma.$disconnect();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

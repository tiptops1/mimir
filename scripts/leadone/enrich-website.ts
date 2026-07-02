import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { discoverWebsiteQuotaed } from "../../src/lib/leadone/search";

// Lead One stage 2 — website discovery for SOURCED candidates, gated by the
// LeadOneQuota ledger (Google CSE 100/day, then Exa.ai 1000/mo). One search
// query per candidate per attempt; 3 dead-end attempts (with query variants)
// → REJECTED. Stops cleanly when every provider's budget is spent — the next
// scheduled run resumes after the quota window resets.
//
// Usage: npx tsx scripts/leadone/enrich-website.ts [--dry] [--limit=50]

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WebsiteStats {
  processed: number;
  found: number;
  rejected: number;
  quotaExhausted: boolean;
}

export async function runEnrichWebsite(
  prisma: PrismaClient,
  opts: { limit?: number; dry?: boolean; deadline?: number } = {},
): Promise<WebsiteStats> {
  const stats: WebsiteStats = {
    processed: 0,
    found: 0,
    rejected: 0,
    quotaExhausted: false,
  };
  const candidates = await prisma.leadCandidate.findMany({
    where: { status: "SOURCED" },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 300,
    select: {
      id: true,
      nomSociete: true,
      enseigne: true,
      attempts: true,
      provenance: true,
    },
  });

  for (const c of candidates) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const name = c.enseigne || c.nomSociete || "";
    const attempts = (c.attempts ?? {}) as Record<string, number>;
    const tries = attempts.website ?? 0;

    if (!name.trim()) {
      stats.rejected++;
      if (!opts.dry)
        await prisma.leadCandidate.update({
          where: { id: c.id },
          data: { status: "REJECTED", lastError: "no-name" },
        });
      continue;
    }

    const r = await discoverWebsiteQuotaed(prisma, name, tries);
    if (r.noProvider) {
      console.warn(
        "No search provider configured (GOOGLE_CSE_KEY/GOOGLE_CSE_CX, EXA_API_KEY " +
          "or LEADONE_KEYLESS=1) — skipping website stage.",
      );
      break; // don't burn candidates' attempts when nothing could run
    }
    if (r.provider === null && r.quotaExhausted) {
      stats.quotaExhausted = true;
      break; // budget spent — resume on the next run
    }
    stats.processed++;

    if (r.site) {
      stats.found++;
      console.log(`✓ ${name} — ${r.site} (${r.provider})`);
      if (!opts.dry)
        await prisma.leadCandidate.update({
          where: { id: c.id },
          data: {
            siteWeb: r.site,
            status: "ENRICHED_WEBSITE",
            provenance: {
              ...((c.provenance ?? {}) as Record<string, unknown>),
              siteWeb: { src: r.provider, at: new Date().toISOString() },
            } as Prisma.InputJsonValue,
          },
        });
    } else {
      const next = tries + 1;
      const dead = next >= MAX_ATTEMPTS;
      if (dead) stats.rejected++;
      console.log(`· ${name} — no confident match (attempt ${next}/${MAX_ATTEMPTS})`);
      if (!opts.dry)
        await prisma.leadCandidate.update({
          where: { id: c.id },
          data: dead
            ? { status: "REJECTED", lastError: "no-website", attempts: { ...attempts, website: next } }
            : { attempts: { ...attempts, website: next } },
        });
    }
    await sleep(1100); // polite delay between search-provider calls
  }
  return stats;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const prisma = new PrismaClient();
  const dry = process.argv.includes("--dry");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined;
  runEnrichWebsite(prisma, { dry, limit })
    .then((s) => {
      console.log(
        `${dry ? "[DRY RUN] " : ""}Websites: ${s.found}/${s.processed} found, ` +
          `${s.rejected} rejected${s.quotaExhausted ? " — quota exhausted, resuming next run" : ""}.`,
      );
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";
import { evaluateGraduation } from "../../src/lib/heimdallr/ledger";
import { listGraduationCandidates } from "../../src/lib/heimdallr/queries";

// S15 — manual graduation sweep. Not wired to a cron (no Inngest cron infra
// exists for any Heimdallr sweep yet, same parked status as sweepExpired /
// sweepBreachedCategories) — run this by hand to promote categories that have
// earned level 2 (events.md "Graduation-math inputs").
//
//   npx tsx scripts/heimdallr/run-graduation-sweep.ts [slug=crm_demo]

async function main() {
  const slug = process.argv[2] ?? "crm_demo";
  const control = new ControlClient();
  try {
    const tenant = await control.tenant.findUnique({
      where: { slug },
      select: { connectionString: true },
    });
    if (!tenant) throw new Error(`Unknown tenant: ${slug}`);

    const prisma = new TenantClient({ datasourceUrl: decrypt(tenant.connectionString) });
    try {
      const candidates = await listGraduationCandidates(prisma);
      if (candidates.length === 0) {
        console.log(`${slug}: no graduation-eligible categories (level 1, maxLevel >= 2).`);
        return;
      }
      for (const { category, label } of candidates) {
        const decision = await evaluateGraduation(prisma, category);
        const pct = decision?.uneditedPct !== null && decision?.uneditedPct !== undefined
          ? `${decision.uneditedPct.toFixed(1)}%`
          : "insufficient sample";
        const outcome = decision?.graduate ? "GRADUATED -> level 2" : "not yet";
        console.log(`${category} (${label}): unedited=${pct} sample=${decision?.sample ?? 0} -> ${outcome}`);
      }
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

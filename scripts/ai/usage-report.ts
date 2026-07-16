import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";
import { checkBudget, usageSnapshot } from "../../src/lib/ai/meter";

/**
 * S5 verification helper (read-only): per-tenant AI usage + budget status,
 * across every ACTIVE tenant (the cross-tenant metering rollup the roadmap
 * flags as S5's problem — usage rows themselves stay per-tenant, S2).
 *
 *   npx tsx scripts/ai/usage-report.ts
 */

async function main() {
  const control = new ControlClient();
  const tenants = await control.tenant.findMany({
    where: { status: "ACTIVE" },
    orderBy: { slug: "asc" },
    select: { slug: true, connectionString: true },
  });

  for (const t of tenants) {
    const prisma = new TenantClient({ datasourceUrl: decrypt(t.connectionString) });
    const budget = await checkBudget(prisma);
    const rows = await usageSnapshot(prisma);

    console.log(`\n=== ${t.slug} ===`);
    console.log(
      `month-to-date: $${budget.used.toFixed(4)} / $${budget.limit} ${budget.ok ? "(ok)" : "(EXCEEDED)"}`,
    );
    if (rows.length === 0) {
      console.log("(no usage recorded)");
    } else {
      console.log("day        provider   model                        taskClass   calls  promptTok  complTok  cost");
      for (const r of rows) {
        console.log(
          `${r.day}  ${r.provider.padEnd(9)}  ${r.model.padEnd(27)}  ${r.taskClass.padEnd(10)}  ${String(r.calls).padStart(5)}  ${String(r.promptTokens).padStart(9)}  ${String(r.completionTokens).padStart(8)}  $${r.costUsd.toFixed(4)}`,
        );
      }
    }
    await prisma.$disconnect();
  }
  await control.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

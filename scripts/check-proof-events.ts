import "dotenv/config";
import { PrismaClient as ControlClient } from "../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../src/lib/crypto";

/**
 * S4 verification helper (read-only): print the proof job's AgentEvent rows
 * for a tenant (default crm_demo), newest first.
 *
 *   npx tsx scripts/check-proof-events.ts [slug]
 */

async function main() {
  const slug = process.argv[2] ?? "crm_demo";
  const control = new ControlClient();
  const tenant = await control.tenant.findUnique({
    where: { slug },
    select: { connectionString: true },
  });
  if (!tenant) throw new Error(`Unknown tenant: ${slug}`);

  const prisma = new TenantClient({
    datasourceUrl: decrypt(tenant.connectionString),
  });
  const events = await prisma.agentEvent.findMany({
    where: { module: "system", category: "queue" },
    orderBy: { at: "desc" },
    take: 10,
  });
  for (const e of events) {
    console.log(
      `${e.at.toISOString()}  ${e.action.padEnd(13)} runId=${e.runId}  data=${JSON.stringify(e.data)}`,
    );
  }
  console.log(`total shown: ${events.length}`);
  await prisma.$disconnect();
  await control.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

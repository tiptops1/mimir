import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedTenantConfig } from "../src/lib/default-config";

// Seed the default tenant config (stages / field defs / starter sequence)
// against DATABASE_URL. Idempotent — safe to re-run. The seed data itself
// lives in src/lib/default-config.ts, shared with Phase-4 self-serve
// provisioning (src/lib/provision.ts).
//
//   npm run config:seed                      // CRM config (the default)
//   npm run config:seed -- --modules chronos // a non-CRM vertical
//
// Module-scoped so a non-CRM tenant doesn't get the CRM's French
// insurance-broker stages, fields and sequences. See src/lib/modules.ts.

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const modules = (arg("modules") ?? "crm")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  await seedTenantConfig(prisma, { modules });
  const fieldCount = await prisma.fieldDefinition.count();
  const stageCount = await prisma.stageDefinition.count();
  console.log(
    `✓ Config seeded (${modules.join(", ")}) — ${stageCount} stages, ${fieldCount} field definitions.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

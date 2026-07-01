import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedTenantConfig } from "../src/lib/default-config";

// Seed the default tenant config (stages / field defs / starter sequence)
// against DATABASE_URL. Idempotent — safe to re-run. The seed data itself
// lives in src/lib/default-config.ts, shared with Phase-4 self-serve
// provisioning (src/lib/provision.ts). Usage: npm run config:seed

const prisma = new PrismaClient();

async function main() {
  await seedTenantConfig(prisma);
  const fieldCount = await prisma.fieldDefinition.count();
  const stageCount = await prisma.stageDefinition.count();
  console.log(
    `✓ Config seeded — ${stageCount} stages, ${fieldCount} field definitions.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

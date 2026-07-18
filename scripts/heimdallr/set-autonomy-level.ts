import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";

// Heimdallr helper — set an autonomy category's level (seeds leave every
// category at 0 = off, so nothing agentic runs until turned on explicitly).
//
//   npx tsx scripts/heimdallr/set-autonomy-level.ts <category> <level> [slug]
//   e.g. npx tsx scripts/heimdallr/set-autonomy-level.ts huginn.support_reply 1

async function main() {
  const [category, levelArg, slug = "crm_demo"] = process.argv.slice(2);
  const level = Number(levelArg);
  if (!category || !Number.isInteger(level) || level < 0 || level > 3) {
    console.error("Usage: set-autonomy-level.ts <category> <0-3> [tenantSlug]");
    process.exit(1);
  }

  const control = new ControlClient();
  try {
    const tenant = await control.tenant.findUnique({
      where: { slug },
      select: { connectionString: true },
    });
    if (!tenant) throw new Error(`Unknown tenant: ${slug}`);

    const prisma = new TenantClient({
      datasourceUrl: decrypt(tenant.connectionString),
    });
    try {
      const config = await prisma.autonomyConfig.findUnique({
        where: { category },
        select: { level: true, maxLevel: true },
      });
      if (!config) throw new Error(`Unknown autonomy category: ${category}`);
      if (level > config.maxLevel) {
        throw new Error(`Level ${level} exceeds maxLevel ${config.maxLevel} for ${category}`);
      }
      await prisma.autonomyConfig.update({
        where: { category },
        data: { level },
      });
      console.log(`${slug}: ${category} level ${config.level} -> ${level}`);
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

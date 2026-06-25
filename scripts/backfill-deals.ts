import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { statusForStage } from "../src/lib/deals";

// One-time, idempotent backfill: give every company a PRIMARY deal carrying its
// current pipeline stage, so the new Deal layer is consistent with the existing
// board. Re-running it is safe (companies that already have a primary deal are
// skipped). Usage: npm run deals:backfill [-- --dry]

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

async function main() {
  const companies = await prisma.company.findMany({
    select: { id: true, stage: true },
  });
  let created = 0;
  let skipped = 0;
  for (const c of companies) {
    const has = await prisma.deal.findFirst({
      where: { companyId: c.id, isPrimary: true },
      select: { id: true },
    });
    if (has) {
      skipped++;
      continue;
    }
    if (!DRY) {
      await prisma.deal.create({
        data: {
          companyId: c.id,
          title: "Opportunité",
          stage: c.stage,
          status: statusForStage(c.stage),
          isPrimary: true,
        },
      });
    }
    created++;
  }
  console.log(
    `${DRY ? "[DRY] " : ""}Primary deals created: ${created}, ` +
      `skipped (already had one): ${skipped}, total companies: ${companies.length}`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

/**
 * scripts/delete-unnamed.ts
 *
 * Delete companies that have no nomSociete AND no enseigne (only a SIRET).
 * Migrates any contacts/activities to... nowhere — they're deleted along with
 * the company since there's no name to merge into.
 *
 * Usage:
 *   npx tsx scripts/delete-unnamed.ts            # run for real
 *   npx tsx scripts/delete-unnamed.ts --dry       # preview only
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

async function main() {
  console.log(DRY ? "*** DRY RUN — no changes ***\n" : "");

  const unnamed = await prisma.company.findMany({
    where: {
      AND: [
        { OR: [{ nomSociete: null }, { nomSociete: "" }] },
        { OR: [{ enseigne: null }, { enseigne: "" }] },
      ],
    },
    select: {
      id: true,
      siret: true,
      _count: { select: { contacts: true, activities: true } },
    },
  });

  console.log(`Found ${unnamed.length} unnamed companies (SIRET-only)`);

  if (unnamed.length === 0) {
    console.log("Nothing to delete.");
    await prisma.$disconnect();
    return;
  }

  const totalContacts = unnamed.reduce((s, c) => s + c._count.contacts, 0);
  const totalActivities = unnamed.reduce((s, c) => s + c._count.activities, 0);
  console.log(`  Associated contacts: ${totalContacts}`);
  console.log(`  Associated activities: ${totalActivities}`);

  if (DRY) {
    console.log(`\n[DRY] Would delete ${unnamed.length} companies, ${totalContacts} contacts, ${totalActivities} activities`);
    await prisma.$disconnect();
    return;
  }

  const ids = unnamed.map((c) => c.id);

  // Delete activities tied to these companies
  const delActivities = await prisma.activity.deleteMany({
    where: { companyId: { in: ids } },
  });
  console.log(`Deleted ${delActivities.count} activities`);

  // Delete contacts tied to these companies
  const delContacts = await prisma.contact.deleteMany({
    where: { companyId: { in: ids } },
  });
  console.log(`Deleted ${delContacts.count} contacts`);

  // Delete the companies
  const delCompanies = await prisma.company.deleteMany({
    where: { id: { in: ids } },
  });
  console.log(`Deleted ${delCompanies.count} unnamed companies`);

  const finalCompanies = await prisma.company.count();
  const finalContacts = await prisma.contact.count();
  console.log(`\n=== Final: ${finalCompanies} companies, ${finalContacts} contacts ===`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

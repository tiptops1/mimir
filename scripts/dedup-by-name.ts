/**
 * scripts/dedup-by-name.ts
 *
 * Remove duplicate companies that share the same effective name
 * (enseigne || nomSociete, case-insensitive). For each group of dupes,
 * keeps the "richest" entry (most contacts, activities, enriched fields)
 * and deletes the rest — migrating any contacts/activities to the survivor.
 *
 * Usage:
 *   npx tsx scripts/dedup-by-name.ts            # run for real
 *   npx tsx scripts/dedup-by-name.ts --dry      # preview only
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

/** Score how "enriched" a company is — higher = better survivor. */
function richness(c: {
  siteWeb: string | null;
  notes: string | null;
  priorite: string | null;
  potentiel: string | null;
  stage: string;
  emailGenerique: string | null;
  telephoneStandard: string | null;
  contactCount: number;
  activityCount: number;
  updatedAt: Date;
}) {
  let score = 0;
  score += c.contactCount * 10;
  score += c.activityCount * 5;
  if (c.siteWeb) score += 8;
  if (c.notes) score += 4;
  if (c.priorite) score += 3;
  if (c.potentiel) score += 3;
  if (c.emailGenerique) score += 2;
  if (c.telephoneStandard) score += 2;
  if (c.stage !== "A_QUALIFIER") score += 5;
  return score;
}

async function main() {
  console.log(DRY ? "*** DRY RUN — no changes ***\n" : "");

  const all = await prisma.company.findMany({
    select: {
      id: true,
      nomSociete: true,
      enseigne: true,
      siret: true,
      ville: true,
      siteWeb: true,
      notes: true,
      stage: true,
      priorite: true,
      potentiel: true,
      emailGenerique: true,
      telephoneStandard: true,
      updatedAt: true,
      _count: { select: { contacts: true, activities: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Group by effective name.
  const byName = new Map<
    string,
    (typeof all[number] & { contactCount: number; activityCount: number })[]
  >();
  for (const c of all) {
    const name = (c.enseigne || c.nomSociete || "").trim().toLowerCase();
    if (!name) continue; // skip unnamed — can't group
    const entry = { ...c, contactCount: c._count.contacts, activityCount: c._count.activities };
    const list = byName.get(name) ?? [];
    list.push(entry);
    byName.set(name, list);
  }

  const dupeGroups = [...byName.entries()]
    .filter(([, g]) => g.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  let removed = 0;
  let movedContacts = 0;
  let movedActivities = 0;

  for (const [name, group] of dupeGroups) {
    // Pick the richest as survivor.
    group.sort((a, b) => richness(b) - richness(a) || b.updatedAt.getTime() - a.updatedAt.getTime());
    const [survivor, ...dupes] = group;

    console.log(
      `${group.length}x "${name}" → keep ${survivor.siret} (${survivor.ville ?? "?"}, score=${richness(survivor)}), remove ${dupes.length}`,
    );

    for (const dupe of dupes) {
      if (DRY) {
        removed++;
        continue;
      }

      // Move contacts to survivor (avoid creating duplicate contacts by name).
      const dupeContacts = await prisma.contact.findMany({
        where: { companyId: dupe.id },
        select: { id: true, nom: true, prenom: true },
      });
      for (const dc of dupeContacts) {
        const exists = await prisma.contact.findFirst({
          where: {
            companyId: survivor.id,
            nom: dc.nom,
            prenom: dc.prenom,
          },
        });
        if (exists) {
          // Duplicate contact — reassign its activities then delete.
          await prisma.activity.updateMany({
            where: { contactId: dc.id },
            data: { contactId: exists.id },
          });
          await prisma.contact.delete({ where: { id: dc.id } });
        } else {
          await prisma.contact.update({
            where: { id: dc.id },
            data: { companyId: survivor.id },
          });
          movedContacts++;
        }
      }

      // Move activities.
      const ma = await prisma.activity.updateMany({
        where: { companyId: dupe.id },
        data: { companyId: survivor.id },
      });
      movedActivities += ma.count;

      // Delete the duplicate company.
      await prisma.company.delete({ where: { id: dupe.id } });
      removed++;
    }
  }

  const finalCompanies = await prisma.company.count();
  const finalContacts = await prisma.contact.count();

  console.log(`\n=== Result ===`);
  console.log(
    `${DRY ? "[DRY] Would remove" : "Removed"} ${removed} duplicate companies`,
  );
  if (!DRY) {
    console.log(`Moved ${movedContacts} contacts, ${movedActivities} activities to survivors`);
    console.log(`Final: ${finalCompanies} companies, ${finalContacts} contacts`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

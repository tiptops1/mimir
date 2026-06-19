/**
 * scripts/enrich-dirigeants.ts
 *
 * Fetch dirigeants from the French government API for companies that still
 * have no contacts. Faster than enrich:all because it skips website discovery.
 *
 * Usage:
 *   npx tsx scripts/enrich-dirigeants.ts
 *   npx tsx scripts/enrich-dirigeants.ts --dry
 *   npx tsx scripts/enrich-dirigeants.ts --limit=50
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { fetchUniteLegale } from "../src/lib/enrich";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(DRY ? "*** DRY RUN ***\n" : "");

  const companies = await prisma.company.findMany({
    where: {
      siren: { not: null },
      contacts: { none: {} },
    },
    select: {
      id: true,
      siren: true,
      nomSociete: true,
      enseigne: true,
    },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
  });

  console.log(`Companies with SIREN but no contacts: ${companies.length}\n`);

  let added = 0;
  let i = 0;

  for (const c of companies) {
    i++;
    const name = c.enseigne || c.nomSociete || "?";

    try {
      const r = await fetchUniteLegale(c.siren!);
      const persons = (r?.dirigeants ?? []).filter(
        (d: any) => d.type_dirigeant === "personne physique" || (d.nom && !d.denomination),
      );

      if (persons.length === 0) {
        if (i <= 20 || i % 50 === 0) console.log(`${i}/${companies.length} · ${name} — no dirigeants`);
        await sleep(300);
        continue;
      }

      for (const d of persons) {
        const nom = d.nom?.trim() || null;
        const prenom = d.prenoms?.trim().split(/\s+/)[0] || null;
        if (!nom && !prenom) continue;

        if (DRY) {
          console.log(`${i}/${companies.length} ✓ ${name} → ${prenom ?? ""} ${nom ?? ""} (${d.qualite ?? "Dirigeant"})`);
        } else {
          await prisma.contact.create({
            data: {
              companyId: c.id,
              nom,
              prenom,
              fonction: d.qualite || "Dirigeant",
            },
          });
        }
        added++;
      }
    } catch (e) {
      console.warn(`${i}/${companies.length} ! ${name} — error: ${(e as Error).message}`);
    }

    await sleep(300);
  }

  const totalContacts = await prisma.contact.count();
  const withContacts = await prisma.company.count({ where: { contacts: { some: {} } } });

  console.log(`\n${DRY ? "[DRY] Would add" : "Added"} ${added} dirigeant contacts`);
  console.log(`Companies with contacts: ${withContacts} / ${await prisma.company.count()}`);
  console.log(`Total contacts: ${totalContacts}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

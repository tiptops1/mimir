import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { enrichCompany, fetchUniteLegale } from "../src/lib/enrich";

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Usage:
//   npm run enrich:all            -> enrich every company
//   npm run enrich:all -- --dry   -> preview only (no DB writes)
//   npm run enrich:all -- --limit=20
async function main() {
  const dry = process.argv.includes("--dry");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined;

  const companies = await prisma.company.findMany({
    where: { siren: { not: null } },
    select: { id: true, siren: true, nomSociete: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  console.log(
    `${dry ? "[DRY RUN] " : ""}Enriching ${companies.length} companies…`,
  );

  let updated = 0;
  let contacts = 0;
  let i = 0;
  for (const c of companies) {
    i++;
    try {
      if (dry) {
        const r = await fetchUniteLegale(c.siren as string);
        const persons = (r?.dirigeants ?? []).filter(
          (d) => d.type_dirigeant === "personne physique",
        );
        console.log(
          `${i}/${companies.length} ${c.siren} -> name="${r?.nom_complet ?? "—"}" dirigeants(persons)=${persons.length}`,
        );
      } else {
        const res = await enrichCompany(prisma, c.id);
        if (res.fieldsUpdated.length || res.contactsAdded) {
          updated++;
          contacts += res.contactsAdded;
          console.log(
            `${i}/${companies.length} ${c.siren} -> ${res.name ?? "—"} [${res.fieldsUpdated.join(",") || "no fields"}] +${res.contactsAdded} contact(s)`,
          );
        }
      }
    } catch (e) {
      console.warn(`${i}/${companies.length} ${c.siren} -> error: ${(e as Error).message}`);
    }
    await sleep(1500); // gentle: web discovery hits DuckDuckGo per company
  }

  console.log(
    dry
      ? "[DRY RUN] complete — no changes written."
      : `Done. Updated ${updated} companies, added ${contacts} contacts.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

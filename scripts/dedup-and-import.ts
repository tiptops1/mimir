/**
 * scripts/dedup-and-import.ts
 *
 * 1. Remove duplicate companies (same SIRET) — keeps the one with the most
 *    recent updatedAt, migrates contacts + activities to the survivor, then
 *    deletes the duplicate.
 * 2. Import the second CSV (data/crm-chris-200-1802.csv) via SIRET upsert,
 *    skipping companies that already exist (preserves enriched data).
 *
 * Usage:
 *   npx tsx scripts/dedup-and-import.ts
 *   npx tsx scripts/dedup-and-import.ts --dry       # preview only
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

// --- CSV parser (same as seed.ts) ---
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else { field += c; }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (v: string | undefined): string | null => {
  if (v === undefined) return null;
  const t = v.trim();
  if (!t || t === "[ND]") return null;
  return t;
};
const toDate = (v: string | undefined): Date | null => {
  const t = clean(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};
const toInt = (v: string | undefined): number | null => {
  const t = clean(v);
  if (!t) return null;
  const n = Number.parseInt(t.replace(/\s/g, ""), 10);
  return Number.isNaN(n) ? null : n;
};
const toBool = (v: string | undefined): boolean => {
  const t = clean(v)?.toLowerCase();
  return t === "oui" || t === "true" || t === "1" || t === "x" || t === "yes";
};

async function deduplicate() {
  console.log("\n=== Phase 1: Deduplication ===");

  const allCompanies = await prisma.company.findMany({
    select: { id: true, siret: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  // Group by SIRET.
  const bySiret = new Map<string, typeof allCompanies>();
  for (const c of allCompanies) {
    const list = bySiret.get(c.siret) ?? [];
    list.push(c);
    bySiret.set(c.siret, list);
  }

  let dupCompanies = 0;
  let movedContacts = 0;
  let movedActivities = 0;

  for (const [siret, group] of bySiret) {
    if (group.length <= 1) continue;

    // Keep the first (most recent updatedAt) — delete the rest.
    const [survivor, ...dupes] = group;
    console.log(
      `  SIRET ${siret}: keeping ${survivor.id}, removing ${dupes.length} duplicate(s)`,
    );

    for (const dupe of dupes) {
      if (DRY) {
        console.log(`    [DRY] would merge ${dupe.id} → ${survivor.id}`);
        dupCompanies++;
        continue;
      }

      // Move contacts to the survivor.
      const mc = await prisma.contact.updateMany({
        where: { companyId: dupe.id },
        data: { companyId: survivor.id },
      });
      movedContacts += mc.count;

      // Move activities to the survivor.
      const ma = await prisma.activity.updateMany({
        where: { companyId: dupe.id },
        data: { companyId: survivor.id },
      });
      movedActivities += ma.count;

      // Delete the duplicate.
      await prisma.company.delete({ where: { id: dupe.id } });
      dupCompanies++;
    }
  }

  console.log(
    dupCompanies === 0
      ? "  No duplicates found."
      : `  ${DRY ? "[DRY] Would remove" : "Removed"} ${dupCompanies} duplicate companies (moved ${movedContacts} contacts, ${movedActivities} activities).`,
  );

  // Also dedup contacts within the same company (same nom + prenom).
  console.log("\n  Deduplicating contacts (same company + name)...");
  const allContacts = await prisma.contact.findMany({
    select: { id: true, companyId: true, nom: true, prenom: true, email: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const contactKey = (c: { companyId: string; nom: string | null; prenom: string | null }) =>
    `${c.companyId}::${(c.nom ?? "").toLowerCase()}::${(c.prenom ?? "").toLowerCase()}`;

  const contactGroups = new Map<string, typeof allContacts>();
  for (const c of allContacts) {
    const k = contactKey(c);
    const list = contactGroups.get(k) ?? [];
    list.push(c);
    contactGroups.set(k, list);
  }

  let dupContacts = 0;
  for (const [, group] of contactGroups) {
    if (group.length <= 1) continue;
    const [, ...extras] = group; // keep first (most recent)
    for (const extra of extras) {
      if (DRY) {
        console.log(`    [DRY] would remove contact ${extra.id} (${extra.nom} ${extra.prenom})`);
      } else {
        await prisma.activity.updateMany({
          where: { contactId: extra.id },
          data: { contactId: null },
        });
        await prisma.contact.delete({ where: { id: extra.id } });
      }
      dupContacts++;
    }
  }
  console.log(
    dupContacts === 0
      ? "  No duplicate contacts found."
      : `  ${DRY ? "[DRY] Would remove" : "Removed"} ${dupContacts} duplicate contacts.`,
  );
}

async function importCsv() {
  console.log("\n=== Phase 2: Import CRM Chris 200-1802 ===");

  const csvPath = join(process.cwd(), "data", "crm-chris-200-1802.csv");
  const text = readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  rows.shift(); // drop header

  let created = 0;
  let skipped = 0;
  let contacts = 0;

  for (const r of rows) {
    if (r.length < 13) continue;
    const siret = clean(r[1]);
    if (!siret) continue;

    // Check if this company already exists — if so, skip (preserve enriched data).
    const existing = await prisma.company.findUnique({ where: { siret } });
    if (existing) {
      skipped++;
      continue;
    }

    const data: Prisma.CompanyUncheckedCreateInput = {
      siren: clean(r[0]),
      siret,
      nomSociete: clean(r[2]),
      enseigne: clean(r[3]),
      categorieEntreprise: clean(r[4]),
      formeJuridique: clean(r[5]),
      dateCreation: toDate(r[6]),
      codeNaf: clean(r[7]),
      libelleNaf: clean(r[8]),
      trancheEffectifs: clean(r[9]),
      adresse: clean(r[10]),
      codePostal: clean(r[11]),
      ville: clean(r[12]),
      siteWeb: clean(r[13]),
      emailGenerique: clean(r[14]),
      telephoneStandard: clean(r[15]),
      specialiteSante: toBool(r[23]),
      specialitePrevoyance: toBool(r[24]),
      specialiteIard: toBool(r[25]),
      specialiteAuto: toBool(r[26]),
      specialiteRcPro: toBool(r[27]),
      specialiteEntreprises: toBool(r[28]),
      specialiteCollectives: toBool(r[29]),
      specialiteParticuliers: toBool(r[30]),
      nbCollaborateursEstime: toInt(r[31]),
      niveauDigitalisation: clean(r[32]),
      icpScore: toInt(r[33]),
      priorite: (clean(r[34])?.toUpperCase() === "A" || clean(r[34])?.toUpperCase() === "B" || clean(r[34])?.toUpperCase() === "C"
        ? clean(r[34])!.toUpperCase() : null) as Prisma.CompanyUncheckedCreateInput["priorite"],
      potentiel: (() => {
        const v = clean(r[35])?.toLowerCase();
        if (v === "faible") return "FAIBLE";
        if (v === "moyen") return "MOYEN";
        if (v === "fort") return "FORT";
        return null;
      })() as Prisma.CompanyUncheckedCreateInput["potentiel"],
      stage: (() => {
        const STAGE_MAP: Record<string, string> = {
          "a qualifier": "A_QUALIFIER", "a contacter": "A_CONTACTER",
          contacte: "CONTACTE", "rdv obtenu": "RDV_OBTENU",
          "demo realisee": "DEMO_REALISEE", "proposition envoyee": "PROPOSITION_ENVOYEE",
          gagne: "GAGNE", perdu: "PERDU",
        };
        const t = clean(r[36]);
        if (!t) return "A_QUALIFIER";
        return STAGE_MAP[t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()] ?? "A_QUALIFIER";
      })() as Prisma.CompanyUncheckedCreateInput["stage"],
      canal: clean(r[37]),
      datePremierContact: toDate(r[38]),
      dernierContact: toDate(r[39]),
      relancePrevue: toDate(r[40]),
      demoRealisee: toBool(r[41]),
      propositionEnvoyee: toBool(r[42]),
      closingEstime: toDate(r[43]),
      notes: clean(r[44]),
    };

    if (DRY) {
      console.log(`  [DRY] would create ${siret} — ${data.nomSociete || data.enseigne || "unnamed"}`);
      created++;
      continue;
    }

    const company = await prisma.company.create({ data });
    created++;

    // Director contact.
    const nom = clean(r[16]);
    const prenom = clean(r[17]);
    const fonction = clean(r[18]);
    const email = clean(r[19]);
    const telephone = clean(r[20]);
    const linkedinUrl = clean(r[21]);
    if (nom || prenom || email || telephone) {
      await prisma.contact.create({
        data: {
          companyId: company.id,
          nom, prenom, fonction, email, telephone, linkedinUrl,
        },
      });
      contacts++;
    }

    if (created % 100 === 0) console.log(`  ... ${created} created`);
  }

  console.log(
    `\n  ${DRY ? "[DRY] Would create" : "Created"} ${created} new companies, ${contacts} contacts. Skipped ${skipped} (already in DB).`,
  );
}

async function summary() {
  const companies = await prisma.company.count();
  const contactCount = await prisma.contact.count();
  console.log(`\n=== Final counts: ${companies} companies, ${contactCount} contacts ===`);
}

async function main() {
  console.log(DRY ? "*** DRY RUN — no changes will be written ***" : "");
  await deduplicate();
  await importCsv();
  await summary();
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

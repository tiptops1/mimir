import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// --- Minimal RFC-4180-ish CSV parser (handles quoted fields & embedded commas) ---
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore (handled with \n)
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
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

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
const normalize = (s: string) =>
  s.normalize("NFD").replace(DIACRITICS, "").toLowerCase().trim();

const STAGE_MAP: Record<string, string> = {
  "a qualifier": "A_QUALIFIER",
  "a contacter": "A_CONTACTER",
  contacte: "CONTACTE",
  "rdv obtenu": "RDV_OBTENU",
  "demo realisee": "DEMO_REALISEE",
  "proposition envoyee": "PROPOSITION_ENVOYEE",
  gagne: "GAGNE",
  perdu: "PERDU",
};

const toStage = (v: string | undefined): string => {
  const t = clean(v);
  if (!t) return "A_QUALIFIER";
  return STAGE_MAP[normalize(t)] ?? "A_QUALIFIER";
};

const toPriorite = (v: string | undefined): "A" | "B" | "C" | null => {
  const t = clean(v)?.toUpperCase();
  return t === "A" || t === "B" || t === "C" ? t : null;
};

const toPotentiel = (
  v: string | undefined,
): "FAIBLE" | "MOYEN" | "FORT" | null => {
  const t = clean(v);
  if (!t) return null;
  const n = normalize(t);
  if (n === "faible") return "FAIBLE";
  if (n === "moyen") return "MOYEN";
  if (n === "fort") return "FORT";
  return null;
};

async function main() {
  // Auth (users/admins) now lives in the CONTROL plane — created by the tenant
  // provisioning/bootstrap scripts, not here. This seed only loads tenant DATA
  // (companies + contacts) into whichever DB DATABASE_URL points at.

  // Import companies from both committed CSVs
  const csvFiles = [
    join(process.cwd(), "data", "crm-chris-0-200.csv"),
    join(process.cwd(), "data", "crm-chris-200-1802.csv"),
  ];

  let companies = 0;
  let contacts = 0;

  for (const csvPath of csvFiles) {
    let text: string;
    try {
      text = readFileSync(csvPath, "utf8");
    } catch {
      console.log(`  Skipping ${csvPath} (not found)`);
      continue;
    }
    console.log(`  Importing ${csvPath}...`);
    const rows = parseCsv(text);
    rows.shift(); // drop header

  for (const r of rows) {
    if (r.length < 13) continue; // skip blank/short lines
    const siret = clean(r[1]);
    if (!siret) continue;

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
      priorite: toPriorite(r[34]),
      potentiel: toPotentiel(r[35]),
      stage: toStage(r[36]) as Prisma.CompanyUncheckedCreateInput["stage"],
      canal: clean(r[37]),
      datePremierContact: toDate(r[38]),
      dernierContact: toDate(r[39]),
      relancePrevue: toDate(r[40]),
      demoRealisee: toBool(r[41]),
      propositionEnvoyee: toBool(r[42]),
      closingEstime: toDate(r[43]),
      notes: clean(r[44]),
    };

    const company = await prisma.company.upsert({
      where: { siret },
      update: data,
      create: data,
    });
    companies++;

    // Create a director contact only if any personal field is present
    const nom = clean(r[16]);
    const prenom = clean(r[17]);
    const fonction = clean(r[18]);
    const email = clean(r[19]);
    const telephone = clean(r[20]);
    const linkedinUrl = clean(r[21]);
    if (nom || prenom || email || telephone) {
      const existing = await prisma.contact.findFirst({
        where: { companyId: company.id, nom, prenom },
      });
      if (!existing) {
        await prisma.contact.create({
          data: {
            companyId: company.id,
            nom,
            prenom,
            fonction,
            email,
            telephone,
            linkedinUrl,
          },
        });
        contacts++;
      }
    }
  }
  } // end csvFiles loop

  console.log(`✓ Imported ${companies} companies, ${contacts} contacts.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

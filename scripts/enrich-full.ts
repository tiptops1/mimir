/**
 * scripts/enrich-full.ts
 *
 * Full enrichment pass:
 *   Phase 1 — Extract person names from company names → create contacts
 *   Phase 2 — Discover websites via Bing/DDG search
 *   Phase 3 — Scrape discovered websites for email / phone
 *
 * Usage:
 *   npx tsx scripts/enrich-full.ts
 *   npx tsx scripts/enrich-full.ts --dry
 *   npx tsx scripts/enrich-full.ts --phase=1       (names only)
 *   npx tsx scripts/enrich-full.ts --phase=2       (websites only)
 *   npx tsx scripts/enrich-full.ts --phase=3       (scrape only)
 *   npx tsx scripts/enrich-full.ts --limit=50
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { discoverWebsiteFree, scrapeSiteContacts } from "../src/lib/enrich";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? Number.parseInt(phaseArg.split("=")[1], 10) : 0; // 0 = all
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── French first names (common set for insurance sector demographics) ───
const FIRST_NAMES = new Set([
  "adam", "adrien", "agnes", "aime", "alain", "albert", "alex", "alexandre",
  "alexis", "alfred", "alice", "aline", "alphonse", "amandine", "andre",
  "andree", "anne", "annie", "antoine", "arnaud", "arthur", "audrey",
  "auguste", "aurelie", "aurelien", "baptiste", "beatrice", "benoit",
  "benjamin", "bernard", "bernadette", "bertrand", "brigitte", "bruno",
  "camille", "carole", "caroline", "catherine", "cecile", "cedric", "celeste",
  "chantal", "charles", "charlotte", "christian", "christiane", "christine",
  "christophe", "claire", "claude", "claudine", "clement", "colette",
  "corinne", "cyrille", "damien", "daniel", "daniele", "danielle", "david",
  "denis", "denise", "desire", "didier", "dimitri", "dominique", "edmond",
  "edouard", "eliane", "elisabeth", "emile", "emilie", "emmanuel",
  "emmanuelle", "eric", "erwan", "etienne", "eugene", "evelyne", "fabien",
  "fabienne", "fabrice", "fernand", "florence", "florent", "florian",
  "francine", "francis", "franck", "francois", "francoise", "frederic",
  "frederique", "gabriel", "gaetan", "genevieve", "georges", "gerard",
  "germain", "ghislain", "ghislaine", "gildas", "gilles", "ginette",
  "guillaume", "gustave", "guy", "gwenael", "gwenaelle", "henri",
  "henriette", "herve", "hubert", "hugues", "isabelle", "jacques",
  "jacqueline", "jean", "jeanne", "jerome", "joel", "joelle", "joseph",
  "josette", "josiane", "julien", "karine", "laetitia", "laurent",
  "laurence", "leon", "liliane", "lionel", "louis", "luc", "lucette",
  "lucien", "lucienne", "ludovic", "madeleine", "marc", "marcel",
  "marcelle", "marguerite", "marie", "marine", "marion", "martial",
  "martine", "mathieu", "matthieu", "maurice", "maxime", "michael",
  "michel", "michele", "monique", "morgan", "muriel", "myriam", "nathalie",
  "nicolas", "nicole", "noel", "norbert", "odette", "odile", "olivier",
  "pascal", "pascale", "patrice", "patricia", "patrick", "paul", "paulette",
  "philippe", "pierre", "quentin", "rachel", "raymond", "regis", "remy",
  "rene", "renee", "richard", "robert", "roger", "roland", "rolland",
  "romain", "ronan", "rose", "samuel", "sandrine", "sebastien", "serge",
  "severine", "simon", "simone", "solange", "sophie", "stephane",
  "stephanie", "sylvain", "sylvie", "therese", "thierry", "thomas",
  "valerie", "veronique", "victor", "vincent", "virginie", "viviane",
  "xavier", "yann", "yannick", "yves", "yvette", "yvon", "yvonne",
]);

function deburr(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const BRAND_NAMES = new Set([
  "mma", "axa", "abeille", "allianz", "maif", "macif", "generali", "groupama",
  "gan", "aviva", "cardif", "swisslife", "april", "covea", "matmut",
  "harmonie", "ag2r", "malakoff", "humanis", "smabtp", "sogessur",
]);

const STRIP_PREFIXES = [
  /^EIRL\s+/i,
  /^EI\s+/i,
  /^CABINET\s+D['']ASSURANCES?\s+/i,
  /^CABINET\s+/i,
  /^AGENCE\s+/i,
  /^SCDF\s+/i,
  /^SARL\s+CABINET\s+/i,
  /^SARL\s+/i,
  /^SAS\s+/i,
  /^SCI\s+/i,
];

const NOISE_WORDS = new Set([
  "assurance", "assurances", "courtage", "cabinet", "agence", "conseil",
  "conseils", "finances", "patrimoine", "prevoyance", "protection",
  "investissements", "placements", "gestion", "eirl", "ei", "sarl", "sas",
  "associes", "associe", "cie",
]);

const STRIP_SUFFIXES = [
  /\s+ET\s+ASSOCIE?S?\s*$/i,
  /\s+&\s+CIE\s*$/i,
  /\s+ASSURANCES?\s+ET\s+PATRIMOINE\s*$/i,
  /\s+COURTAGE\s+ET\s+CONSEILS?\s*$/i,
  /\s+COURTAGE\s*$/i,
  /\s+ASSURANCES?\s*$/i,
  /\s+CONSEIL\s*$/i,
  /\s+FINANCES?\s*$/i,
  /\s+PATRIMOINE\s*$/i,
];

// Common compound first names (JEAN-X, MARIE-X, ANNE-X, etc.)
const COMPOUND_FIRSTS: Record<string, boolean> = {};
for (const prefix of ["jean", "marie", "anne", "pierre"]) {
  for (const fn of FIRST_NAMES) {
    if (fn !== prefix) COMPOUND_FIRSTS[`${prefix} ${fn}`] = true;
  }
}

interface ParsedPerson { prenom: string; nom: string }

function extractPersonsFromName(companyName: string): ParsedPerson[] {
  const raw = companyName.trim();
  if (!raw) return [];

  // Strip prefixes
  let cleaned = raw;
  for (const re of STRIP_PREFIXES) cleaned = cleaned.replace(re, "");
  // Strip suffixes
  for (const re of STRIP_SUFFIXES) cleaned = cleaned.replace(re, "");
  // Strip brand names and noise words
  cleaned = cleaned.split(/\s+/).filter((w) => {
    const d = deburr(w);
    return !BRAND_NAMES.has(d) && !NOISE_WORDS.has(d);
  }).join(" ").trim();

  if (!cleaned) return [];

  // Split by & or ET for multiple people (but not "ET" inside a suffix we already stripped)
  const parts = cleaned.split(/\s*[&]\s*|\s+ET\s+/i).map((p) => p.trim()).filter(Boolean);

  const persons: ParsedPerson[] = [];
  for (const part of parts) {
    const person = parseSinglePerson(part);
    if (person) persons.push(person);
  }
  return persons;
}

function parseSinglePerson(part: string): ParsedPerson | null {
  const words = part.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return null;

  // Check for compound first name (e.g., "JEAN YVES LE DENMAT" → "Jean-Yves", "LE DENMAT")
  if (words.length >= 3) {
    const twoWord = deburr(words[0]) + " " + deburr(words[1]);
    if (COMPOUND_FIRSTS[twoWord]) {
      const prenom = capitalize(words[0]) + "-" + capitalize(words[1]);
      const nom = words.slice(2).join(" ").toUpperCase();
      return { prenom, nom };
    }
  }

  // Find the first name — try each position
  // Strategy: prefer the first recognized first name, reading left to right
  for (let i = 0; i < words.length; i++) {
    const w = deburr(words[i]);
    if (!FIRST_NAMES.has(w)) continue;

    // Found a first name at position i — build the last name from remaining words
    const remaining = [...words.slice(0, i), ...words.slice(i + 1)]
      .filter((r) => !NOISE_WORDS.has(deburr(r)) && !BRAND_NAMES.has(deburr(r)));
    if (remaining.length === 0) return null;

    return {
      prenom: capitalize(words[i]),
      nom: remaining.join(" ").toUpperCase(),
    };
  }

  return null;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ─── Phase 1: Extract contacts from company names ───
async function phase1() {
  console.log("\n═══ Phase 1: Extract contacts from company names ═══\n");

  const companies = await prisma.company.findMany({
    where: { contacts: { none: {} } },
    select: {
      id: true,
      nomSociete: true,
      enseigne: true,
    },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
  });

  console.log(`Companies with no contacts: ${companies.length}\n`);

  let created = 0;
  let skipped = 0;

  for (const c of companies) {
    const name = c.enseigne || c.nomSociete || "";
    const persons = extractPersonsFromName(name);

    if (persons.length === 0) {
      skipped++;
      continue;
    }

    for (const p of persons) {
      if (DRY) {
        console.log(`  [DRY] ${name} → ${p.prenom} ${p.nom}`);
      } else {
        await prisma.contact.create({
          data: {
            companyId: c.id,
            prenom: p.prenom,
            nom: p.nom,
            fonction: "Dirigeant",
          },
        });
      }
      created++;
    }
  }

  console.log(
    `\n${DRY ? "[DRY] Would create" : "Created"} ${created} contacts from company names. ` +
    `Skipped ${skipped} (no person name detected).`,
  );
}

// ─── Phase 2: Discover websites ───
async function phase2() {
  console.log("\n═══ Phase 2: Discover websites via search ═══\n");

  const companies = await prisma.company.findMany({
    where: { OR: [{ siteWeb: null }, { siteWeb: "" }] },
    select: { id: true, nomSociete: true, enseigne: true, ville: true },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
  });

  console.log(`Companies missing websites: ${companies.length}\n`);

  let found = 0;
  let i = 0;

  for (const c of companies) {
    i++;
    const name = c.enseigne || c.nomSociete || "";
    if (!name.trim()) {
      console.log(`${i}/${companies.length} (no name) — skipped`);
      continue;
    }

    try {
      const site = await discoverWebsiteFree(name, c.ville);
      if (site) {
        found++;
        if (!DRY) {
          await prisma.company.update({ where: { id: c.id }, data: { siteWeb: site } });
        }
        console.log(`${i}/${companies.length} ✓ ${name} — ${site}`);
      } else {
        console.log(`${i}/${companies.length} · ${name} — no match`);
      }
    } catch (e) {
      console.warn(`${i}/${companies.length} ! ${name} — error: ${(e as Error).message}`);
    }

    await sleep(2000);
  }

  console.log(
    `\n${DRY ? "[DRY] Would find" : "Found"} ${found} websites out of ${companies.length}.`,
  );
}

// ─── Phase 3: Scrape websites for email / phone ───
async function phase3() {
  console.log("\n═══ Phase 3: Scrape websites for email/phone ═══\n");

  const companies = await prisma.company.findMany({
    where: {
      siteWeb: { not: null },
      OR: [
        { emailGenerique: null },
        { emailGenerique: "" },
        { telephoneStandard: null },
        { telephoneStandard: "" },
      ],
    },
    select: { id: true, nomSociete: true, enseigne: true, siteWeb: true, emailGenerique: true, telephoneStandard: true },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
  });

  console.log(`Companies with website but missing email/phone: ${companies.length}\n`);

  let enriched = 0;
  let i = 0;

  for (const c of companies) {
    i++;
    const name = c.enseigne || c.nomSociete || "";
    try {
      const { email, phone } = await scrapeSiteContacts(c.siteWeb!);
      const update: Record<string, string> = {};
      if (!c.emailGenerique && email) update.emailGenerique = email;
      if (!c.telephoneStandard && phone) update.telephoneStandard = phone;

      if (Object.keys(update).length > 0) {
        enriched++;
        if (!DRY) {
          await prisma.company.update({ where: { id: c.id }, data: update });
        }
        console.log(`${i}/${companies.length} ✓ ${name} — ${email ?? "no email"} / ${phone ?? "no phone"}`);
      } else {
        console.log(`${i}/${companies.length} · ${name} — nothing found on ${c.siteWeb}`);
      }
    } catch (e) {
      console.warn(`${i}/${companies.length} ! ${name} — error: ${(e as Error).message}`);
    }

    await sleep(1000);
  }

  console.log(
    `\n${DRY ? "[DRY] Would enrich" : "Enriched"} ${enriched} companies with email/phone.`,
  );
}

async function summary() {
  const total = await prisma.company.count();
  const withWebsite = await prisma.company.count({ where: { siteWeb: { not: null } } });
  const withContacts = await prisma.company.count({ where: { contacts: { some: {} } } });
  const withEmail = await prisma.company.count({ where: { emailGenerique: { not: null } } });
  const withPhone = await prisma.company.count({ where: { telephoneStandard: { not: null } } });
  const totalContacts = await prisma.contact.count();

  console.log("\n═══ Summary ═══");
  console.log(`Companies: ${total}`);
  console.log(`  With website: ${withWebsite} (${Math.round(withWebsite / total * 100)}%)`);
  console.log(`  With email: ${withEmail} (${Math.round(withEmail / total * 100)}%)`);
  console.log(`  With phone: ${withPhone} (${Math.round(withPhone / total * 100)}%)`);
  console.log(`  With contacts: ${withContacts} (${Math.round(withContacts / total * 100)}%)`);
  console.log(`Total contacts: ${totalContacts}`);
}

async function main() {
  console.log(DRY ? "*** DRY RUN ***" : "");

  if (PHASE === 0 || PHASE === 1) await phase1();
  if (PHASE === 0 || PHASE === 2) await phase2();
  if (PHASE === 0 || PHASE === 3) await phase3();
  await summary();

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

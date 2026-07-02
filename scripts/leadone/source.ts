import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

// Lead One stage 1 — sourcing from recherche-entreprises.api.gouv.fr (free, no
// key). Pulls every ACTIVE unité légale under the configured NAF codes
// (default 66.22Z — agents & courtiers d'assurance) with a minimal payload
// (minimal=true&include=siege,dirigeants) and stages them as LeadCandidate.
//
// The API caps any query at 10k results, so we segment by département and keep
// a resumable cursor in Setting("leadone.source.cursor") — every establishment
// is fetched from the registry once, ever. Companies already in the CRM are
// skipped before staging (no wasted work downstream).
//
// Usage: npx tsx scripts/leadone/source.ts [--dry] [--max=500]

const API = "https://recherche-entreprises.api.gouv.fr/search";
const CURSOR_KEY = "leadone.source.cursor";
const NAF_KEY = "leadone.nafCodes";
const DEFAULT_NAF = ["66.22Z"]; // agents & courtiers d'assurances (full NN.NNL code required)
const RESWEEP_DAYS = 30; // full registry re-sweep cadence once backfill is done

const DEPARTEMENTS = [
  ...Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, "0")),
  "2A",
  "2B",
  ...Array.from({ length: 75 }, (_, i) => String(i + 21)),
  "971",
  "972",
  "973",
  "974",
  "976",
];

interface Cursor {
  nafIndex: number;
  deptIndex: number;
  page: number;
  completedAt?: string; // set when a full sweep finished
}

interface ApiDirigeant {
  nom?: string;
  prenoms?: string;
  qualite?: string | null;
  type_dirigeant?: string;
}
interface ApiResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string | null;
  dirigeants?: ApiDirigeant[];
  siege?: { siret?: string; liste_enseignes?: string[] | null };
}
interface ApiResponse {
  results?: ApiResult[];
  total_pages?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getSetting(prisma: PrismaClient, key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function setSetting(prisma: PrismaClient, key: string, value: string) {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function fetchPage(
  naf: string,
  departement: string,
  page: number,
): Promise<ApiResponse | null> {
  const url =
    `${API}?activite_principale=${encodeURIComponent(naf)}` +
    `&departement=${departement}&etat_administratif=A` +
    `&page=${page}&per_page=25&minimal=true&include=siege,dirigeants`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? "2");
        await sleep((Number.isFinite(wait) ? wait : 2) * 1000);
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as ApiResponse;
    } catch {
      // Transient socket close / timeout — back off and retry.
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

export interface SourceStats {
  requests: number;
  seen: number;
  staged: number;
  skippedExisting: number;
  sweepDone: boolean;
}

export async function runSource(
  prisma: PrismaClient,
  opts: { max?: number; dry?: boolean; deadline?: number } = {},
): Promise<SourceStats> {
  const max = opts.max ?? 5000;
  const stats: SourceStats = {
    requests: 0,
    seen: 0,
    staged: 0,
    skippedExisting: 0,
    sweepDone: false,
  };

  const nafRaw = await getSetting(prisma, NAF_KEY);
  const nafCodes: string[] = nafRaw ? JSON.parse(nafRaw) : DEFAULT_NAF;
  if (!nafRaw && !opts.dry) await setSetting(prisma, NAF_KEY, JSON.stringify(nafCodes));

  const cursorRaw = await getSetting(prisma, CURSOR_KEY);
  const cursor: Cursor = cursorRaw
    ? (JSON.parse(cursorRaw) as Cursor)
    : { nafIndex: 0, deptIndex: 0, page: 1 };

  // A finished sweep only restarts after RESWEEP_DAYS (new registrations are
  // rare enough; existing SIRETs are skipped cheaply on re-sweep).
  if (cursor.completedAt) {
    const age = Date.now() - new Date(cursor.completedAt).getTime();
    if (age < RESWEEP_DAYS * 24 * 3600 * 1000) {
      console.log(
        `Sourcing sweep complete on ${cursor.completedAt.slice(0, 10)} — next re-sweep in ` +
          `${Math.ceil(RESWEEP_DAYS - age / 86400000)} day(s).`,
      );
      stats.sweepDone = true;
      return stats;
    }
    cursor.nafIndex = 0;
    cursor.deptIndex = 0;
    cursor.page = 1;
    delete cursor.completedAt;
  }

  // Skip anything already in the CRM or already staged. SIREN-level too: a
  // multi-agency network (GAN, MMA, APRIL…) has hundreds of establishments —
  // one lead per legal entity is enough, and it protects the search quota.
  const [companies, candidates] = await Promise.all([
    prisma.company.findMany({ select: { siret: true, siren: true } }),
    prisma.leadCandidate.findMany({ select: { siret: true, siren: true } }),
  ]);
  const knownSirets = new Set<string>([
    ...companies.map((c) => c.siret),
    ...candidates.map((c) => c.siret),
  ]);
  const knownSirens = new Set<string>(
    [...companies, ...candidates]
      .map((c) => c.siren)
      .filter((s): s is string => Boolean(s)),
  );

  while (stats.seen < max) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    if (cursor.nafIndex >= nafCodes.length) {
      cursor.completedAt = new Date().toISOString();
      stats.sweepDone = true;
      break;
    }
    const naf = nafCodes[cursor.nafIndex];
    const dept = DEPARTEMENTS[cursor.deptIndex];

    const data = await fetchPage(naf, dept, cursor.page);
    stats.requests++;
    if (data === null) {
      // Page kept failing — stop here; the cursor hasn't advanced, so the
      // next run retries exactly this page.
      console.warn(`Page failed after retries (${naf} dept ${dept} p${cursor.page}) — stopping stage.`);
      break;
    }
    const results = data.results ?? [];
    const totalPages = data.total_pages ?? 0;

    for (const r of results) {
      const siret = r.siege?.siret;
      const nom = r.nom_complet || r.nom_raison_sociale || null;
      stats.seen++;
      if (!siret || !r.siren || !nom) continue;
      if (knownSirets.has(siret) || knownSirens.has(r.siren)) {
        stats.skippedExisting++;
        continue;
      }
      knownSirets.add(siret);
      knownSirens.add(r.siren);
      stats.staged++;
      if (opts.dry) {
        console.log(`  [dry] ${siret} ${nom} (${dept})`);
        continue;
      }
      const dirigeants = (r.dirigeants ?? [])
        .filter((d) => d.type_dirigeant === "personne physique" && (d.nom || d.prenoms))
        .map((d) => ({
          nom: d.nom?.trim() || null,
          prenom: d.prenoms?.trim().split(/\s+/)[0] || null,
          qualite: d.qualite?.trim() || null,
        }));
      await prisma.leadCandidate.upsert({
        where: { siret },
        update: {}, // re-sweep must never clobber enrichment in progress
        create: {
          siren: r.siren,
          siret,
          nomSociete: nom,
          enseigne: r.siege?.liste_enseignes?.[0]?.trim() || null,
          departement: dept,
          dirigeants,
          provenance: {
            source: { src: "recherche-entreprises", naf, at: new Date().toISOString() },
          },
          attempts: { website: 0, contact: 0 },
        },
      });
    }

    // Advance: next page → next département → next NAF code.
    if (cursor.page < totalPages) cursor.page++;
    else if (cursor.deptIndex < DEPARTEMENTS.length - 1) {
      cursor.deptIndex++;
      cursor.page = 1;
    } else {
      cursor.nafIndex++;
      cursor.deptIndex = 0;
      cursor.page = 1;
    }
    if (!opts.dry) await setSetting(prisma, CURSOR_KEY, JSON.stringify(cursor));
    await sleep(200); // ~5 req/s, well under the API's tolerance
  }

  if (!opts.dry) await setSetting(prisma, CURSOR_KEY, JSON.stringify(cursor));
  return stats;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const prisma = new PrismaClient();
  const dry = process.argv.includes("--dry");
  const maxArg = process.argv.find((a) => a.startsWith("--max="));
  const max = maxArg ? Number.parseInt(maxArg.split("=")[1], 10) : undefined;
  runSource(prisma, { dry, max })
    .then((s) => {
      console.log(
        `${dry ? "[DRY RUN] " : ""}Sourcing: ${s.staged} staged, ` +
          `${s.skippedExisting} already known, ${s.requests} API requests` +
          `${s.sweepDone ? " — sweep complete" : ""}.`,
      );
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

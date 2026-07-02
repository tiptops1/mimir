import type { Prisma, PrismaClient } from "@prisma/client";

// Enrichment via the official French open company API (no key required).
// Public registry data keyed by SIREN — fills company-level fields and creates
// director (dirigeant) contacts. Website / email / phone are NOT provided here.

const API = "https://recherche-entreprises.api.gouv.fr/search";

interface ApiDirigeant {
  nom?: string;
  prenoms?: string;
  qualite?: string | null;
  denomination?: string;
  type_dirigeant?: string;
}
interface ApiSiege {
  adresse?: string;
  code_postal?: string;
  libelle_commune?: string;
}
interface ApiResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string | null;
  date_creation?: string;
  libelle_activite_principale?: string;
  siege?: ApiSiege;
  dirigeants?: ApiDirigeant[];
}
interface ApiResponse {
  results?: ApiResult[];
}

export interface EnrichResult {
  found: boolean;
  name: string | null;
  fieldsUpdated: string[];
  contactsAdded: number;
}

export async function fetchUniteLegale(
  siren: string,
): Promise<ApiResult | null> {
  const url = `${API}?q=${encodeURIComponent(siren)}&page=1&per_page=1`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as ApiResponse;
  const results = data.results ?? [];
  return results.find((r) => r.siren === siren) ?? results[0] ?? null;
}

// --- Website discovery via Pappers (optional free key) ---
export async function discoverWebsite(siren: string): Promise<string | null> {
  const key = process.env.PAPPERS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.pappers.fr/v2/entreprise?api_token=${key}&siren=${siren}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { site_web?: string | null };
    return d.site_web?.trim() || null;
  } catch {
    return null;
  }
}

// --- Free, keyless website discovery ----------------------------------------
// Strategy: query Bing HTML (reliable, residential-IP friendly) plus, as a
// bonus, DuckDuckGo Lite (rate-limits hard, so we tolerate empty responses).
// We then accept a candidate domain ONLY if its label strongly matches the
// company name — this is what keeps us from saving a directory or an unrelated
// firm that merely shares a common first name. A wrong website is worse than a
// blank one in a CRM, so the matcher errs on the side of leaving it empty.

const SEARCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Aggregators / directories / social / registry sites — never the real site.
const BLOCK_DOMAIN =
  /(duckduckgo|google|bing\.|facebook|fb\.com|instagram|twitter|x\.com|youtube|tiktok|linkedin|societe\.com|pappers|verif\.|infogreffe|pagesjaunes|wikipedia|score3|manageo|bodacc|annuaire|kompass|dnb\.com|leboncoin|indeed|trustpilot|mappy|yelp|justacote|cataloxy|cylex|baidu|zhihu|figaro|usine-digitale|b-reputation|ellisphere|france-entreprise|data\.gouv|sirene|insee|opendatasoft|linternaute|journaldunet|hoodspot|webentreprise|118000|118712|local\.fr|le-260|avis-?verifies|amazon|booking|tripadvisor|glassdoor|welcometothejungle|hellowork|banque-france|acpr|orias|verif-?siret|pole-?emploi|leparisien|ouest-france)/i;

// Generic words that must not, on their own, drive a domain match.
const NAME_STOP = new Set([
  "sarl", "sas", "sasu", "sa", "eurl", "snc", "sci", "selarl", "scop", "scs",
  "assurance", "assurances", "courtage", "cabinet", "groupe", "group", "agence",
  "conseil", "conseils", "compagnie", "assur", "societe", "services", "service",
  "france", "gestion", "et", "de", "des", "du", "la", "le", "les", "aux",
  "mr", "mme", "saint", "st",
]);

function deburr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function nameTokens(name: string): string[] {
  return [
    ...new Set(
      deburr(name)
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !NAME_STOP.has(t)),
    ),
  ];
}

function domainLabel(host: string): string {
  return host.replace(/^www\./, "").split(".").slice(0, -1).join("");
}

// Does this host's domain label match the company name strongly enough to keep?
export function hostMatchesName(host: string, name: string): boolean {
  const label = deburr(domainLabel(host));
  const toks = nameTokens(name);
  if (toks.length === 0) return false;
  const hits = toks.filter((t) => label.includes(t));
  if (hits.length >= 2) return true; // two distinct name tokens in the domain
  const concat = toks.join("");
  if (concat.length >= 5 && label === concat) return true; // domain == name run together
  // A single token can only validate a domain when the company name is itself a
  // single word (e.g. "VERLINGUE", "SOGEGRI"). For multi-word names — typically a
  // person, "Prénom NOM" — one token isn't enough: a common first name like
  // "christian" must not validate christian.fr.
  if (toks.length === 1) {
    const t = toks[0];
    return t.length >= 6 && (label === t || label.startsWith(t) || (t.startsWith(label) && label.length >= 5));
  }
  return false;
}

export function hostsFromUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "");
      if (host.includes(".") && !BLOCK_DOMAIN.test(host)) out.push(host);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function bingSearch(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&mkt=fr-FR`,
      { headers: { "user-agent": SEARCH_UA, accept: "text/html" }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return [];
    const html = await res.text();
    const urls: string[] = [];
    // Bing shows the result URL in <cite> (e.g. "https://www.example.fr › path")
    for (const m of html.matchAll(/<cite>([^<]+)<\/cite>/g)) {
      let c = m[1].replace(/\s*›.*$/, "").replace(/\s+/g, "");
      if (!/^https?:\/\//.test(c)) c = "https://" + c;
      urls.push(c);
    }
    return urls;
  } catch {
    return [];
  }
}

async function ddgLiteSearch(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
      { headers: { "user-agent": SEARCH_UA, accept: "text/html" }, signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return []; // 202 = throttled; just skip this source
    const html = await res.text();
    const urls: string[] = [];
    for (const m of html.matchAll(/uddg=([^&"']+)/g)) {
      try {
        urls.push(decodeURIComponent(m[1]));
      } catch {
        /* ignore bad encodings */
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export async function discoverWebsiteFree(
  name: string,
  ville?: string | null,
): Promise<string | null> {
  if (!name.trim()) return null;
  const query = `${name} ${ville ?? ""} assurance`.trim();
  const hosts = [
    ...hostsFromUrls(await bingSearch(query)),
    ...hostsFromUrls(await ddgLiteSearch(query)),
  ];
  const seen = new Set<string>();
  for (const host of hosts) {
    if (seen.has(host)) continue;
    seen.add(host);
    if (hostMatchesName(host, name)) return `https://${host}`;
  }
  return null;
}

// --- Site scraping for generic email / phone (free, best-effort) ---
const BAD_EMAIL =
  /(example|sentry|wixpress|cloudflare|\.png|\.jpg|\.gif|@2x|sentry\.io|votre@|nom@|email@|@domaine)/i;

export function extractEmail(html: string): string | null {
  const matches =
    html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const m of matches) if (!BAD_EMAIL.test(m)) return m.toLowerCase();
  return null;
}

export function normalizeFrPhone(raw: string): string | null {
  let d = raw.replace(/[^0-9+]/g, "");
  if (d.startsWith("+33")) d = "0" + d.slice(3);
  else if (d.startsWith("0033")) d = "0" + d.slice(4);
  if (!/^0\d{9}$/.test(d)) return null;
  return d.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

export function extractPhone(html: string): string | null {
  const candidates: string[] = [];
  for (const m of html.matchAll(/tel:([+0-9 .\-()]{6,})/gi))
    candidates.push(m[1]);
  for (const m of html.matchAll(
    /(?:\+33|0)[\s.\-]?[1-9](?:[\s.\-]?\d{2}){4}/g,
  ))
    candidates.push(m[0]);
  for (const c of candidates) {
    const n = normalizeFrPhone(c);
    if (n) return n;
  }
  return null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (AveliorAnalytics enrichment)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("text/html"))
      return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function scrapeSiteContacts(
  siteWeb: string,
): Promise<{ email: string | null; phone: string | null }> {
  const base = siteWeb.startsWith("http") ? siteWeb : `https://${siteWeb}`;
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return { email: null, phone: null };
  }
  // French sites must publish "mentions légales" with contact details.
  const paths = [
    "",
    "/mentions-legales",
    "/mentions-legales/",
    "/contact",
    "/contact/",
    "/nous-contacter",
  ];
  let email: string | null = null;
  let phone: string | null = null;
  for (const p of paths) {
    if (email && phone) break;
    const html = await fetchText(origin + p);
    if (!html) continue;
    email = email ?? extractEmail(html);
    phone = phone ?? extractPhone(html);
  }
  return { email, phone };
}

/**
 * Enrich a single company in place. Only fills fields that are currently empty
 * (never overwrites data you've entered) and adds director contacts that don't
 * already exist.
 */
export async function enrichCompany(
  prisma: PrismaClient,
  companyId: string,
): Promise<EnrichResult> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: { contacts: true },
  });
  if (!company?.siren) {
    return { found: false, name: null, fieldsUpdated: [], contactsAdded: 0 };
  }

  const r = await fetchUniteLegale(company.siren);
  if (!r) {
    return {
      found: false,
      name: company.nomSociete,
      fieldsUpdated: [],
      contactsAdded: 0,
    };
  }

  const update: Prisma.CompanyUpdateInput = {};
  const fields: string[] = [];

  if (!company.nomSociete && r.nom_complet) {
    update.nomSociete = r.nom_complet;
    fields.push("nomSociete");
  }
  if (!company.adresse && r.siege?.adresse) {
    update.adresse = r.siege.adresse;
    fields.push("adresse");
  }
  if (!company.ville && r.siege?.libelle_commune) {
    update.ville = r.siege.libelle_commune;
    fields.push("ville");
  }
  if (!company.codePostal && r.siege?.code_postal) {
    update.codePostal = r.siege.code_postal;
    fields.push("codePostal");
  }
  if (!company.libelleNaf && r.libelle_activite_principale) {
    update.libelleNaf = r.libelle_activite_principale;
    fields.push("libelleNaf");
  }
  if (!company.dateCreation && r.date_creation) {
    const d = new Date(r.date_creation);
    if (!Number.isNaN(d.getTime())) {
      update.dateCreation = d;
      fields.push("dateCreation");
    }
  }

  if (fields.length > 0) {
    await prisma.company.update({ where: { id: companyId }, data: update });
  }

  // --- Website + generic contact enrichment (free, best-effort) ---
  try {
    let siteWeb = company.siteWeb;
    const webUpdate: Prisma.CompanyUpdateInput = {};
    if (!siteWeb) {
      // 1) Pappers (if a key is configured), else 2) free DuckDuckGo lookup.
      let found = await discoverWebsite(company.siren);
      if (!found) {
        const name =
          (update.nomSociete as string | undefined) ??
          company.nomSociete ??
          r.nom_complet ??
          null;
        const ville = company.ville ?? r.siege?.libelle_commune ?? null;
        if (name) found = await discoverWebsiteFree(name, ville);
      }
      if (found) {
        siteWeb = found;
        webUpdate.siteWeb = found;
        fields.push("siteWeb");
      }
    }
    if (siteWeb && (!company.emailGenerique || !company.telephoneStandard)) {
      const { email, phone } = await scrapeSiteContacts(siteWeb);
      if (!company.emailGenerique && email) {
        webUpdate.emailGenerique = email;
        fields.push("emailGenerique");
      }
      if (!company.telephoneStandard && phone) {
        webUpdate.telephoneStandard = phone;
        fields.push("telephoneStandard");
      }
    }
    if (Object.keys(webUpdate).length > 0) {
      await prisma.company.update({ where: { id: companyId }, data: webUpdate });
    }
  } catch {
    // best-effort — never fail enrichment on web errors
  }

  // Director contacts — real people only (skip "personne morale" companies).
  let contactsAdded = 0;
  const persons = (r.dirigeants ?? []).filter(
    (d) => d.type_dirigeant === "personne physique" || (d.nom && !d.denomination),
  );
  for (const d of persons) {
    const nom = d.nom?.trim() || null;
    const prenom = d.prenoms?.trim().split(/\s+/)[0] || null;
    if (!nom && !prenom) continue;
    const exists = company.contacts.some(
      (c) => (c.nom ?? "") === (nom ?? "") && (c.prenom ?? "") === (prenom ?? ""),
    );
    if (exists) continue;
    await prisma.contact.create({
      data: {
        companyId,
        nom,
        prenom,
        fonction: d.qualite || "Dirigeant",
      },
    });
    contactsAdded++;
  }

  return {
    found: true,
    name: (update.nomSociete as string | undefined) ?? company.nomSociete,
    fieldsUpdated: fields,
    contactsAdded,
  };
}

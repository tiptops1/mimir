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

// --- Free, keyless website discovery via DuckDuckGo HTML (best-effort) ---
// Aggregators / directories / social we never want to mistake for the site.
const BLOCK_DOMAIN =
  /(duckduckgo|google|bing\.|facebook|linkedin|instagram|twitter|x\.com|youtube|societe\.com|pappers|verif\.|infogreffe|pagesjaunes|wikipedia|score3|manageo|bodacc|annuaire|kompass|dnb\.com|leboncoin|indeed|trustpilot|mappy|yelp|figaro|usine-digitale)/i;

async function ddgSearch(query: string): Promise<string[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          accept: "text/html",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
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

function pickWebsite(urls: string[]): string | null {
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "");
      if (host.includes(".") && !BLOCK_DOMAIN.test(host)) {
        return `https://${host}`;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

// Brave Search API — free tier (2k/month) with a key. Reliable JSON results.
async function braveSearch(query: string): Promise<string[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&country=fr`,
      {
        headers: {
          accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": key,
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      web?: { results?: { url?: string }[] };
    };
    return (data.web?.results ?? [])
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u));
  } catch {
    return [];
  }
}

export async function discoverWebsiteFree(
  name: string,
  ville?: string | null,
): Promise<string | null> {
  const query = `${name} ${ville ?? ""} assurance courtage`.trim();
  // Prefer Brave (keyed, reliable); fall back to keyless DuckDuckGo.
  return pickWebsite(await braveSearch(query)) ?? pickWebsite(await ddgSearch(query));
}

// --- Site scraping for generic email / phone (free, best-effort) ---
const BAD_EMAIL =
  /(example|sentry|wixpress|cloudflare|\.png|\.jpg|\.gif|@2x|sentry\.io|votre@|nom@|email@|@domaine)/i;

function extractEmail(html: string): string | null {
  const matches =
    html.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  for (const m of matches) if (!BAD_EMAIL.test(m)) return m.toLowerCase();
  return null;
}

function normalizeFrPhone(raw: string): string | null {
  let d = raw.replace(/[^0-9+]/g, "");
  if (d.startsWith("+33")) d = "0" + d.slice(3);
  else if (d.startsWith("0033")) d = "0" + d.slice(4);
  if (!/^0\d{9}$/.test(d)) return null;
  return d.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
}

function extractPhone(html: string): string | null {
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

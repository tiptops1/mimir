import { extractPhone } from "../enrich";

// Lead One site crawler: polite, identified, minimal. Fetches at most the
// homepage + contact + mentions-légales pages (French law requires mentions
// légales to publish contact details), 2 s between requests, and honors
// robots.txt Disallow for "*". Never stores raw HTML — only the extracted
// email / phone / speciality flags leave this module.

const UA = "Mimir-LeadOne/1.0 (prospection B2B assurance; robot poli)";
const PAGE_TIMEOUT_MS = 8000;
const DELAY_MS = 2000;
const PATHS = [
  "",
  "/contact",
  "/contact/",
  "/nous-contacter",
  "/mentions-legales",
  "/mentions-legales/",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- email extraction (all matches, so we can prefer nominative on-domain) ---
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BAD_EMAIL =
  /(example|sentry|wixpress|cloudflare|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|@2x|@3x|votre@|nom@|email@|@domaine|@email|@exemple|no-?reply|schema\.org)/i;
const GENERIC_LOCALPART =
  /^(contact|info|infos|accueil|bonjour|hello|courrier|secretariat|administration|admin|commercial|commerciaux|gestion|direction|agence|cabinet|assurance|assurances|courtage|contactez|service|services|support|rgpd|dpo|marketing|communication|recrutement|compta|comptabilite|devis|sinistre|sinistres)([._-].*)?$/i;

export type EmailKind = "NOMINATIVE" | "GENERIC" | "NONE";

function extractAllEmails(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.match(EMAIL_RE) ?? []) {
    if (!BAD_EMAIL.test(m)) out.add(m.toLowerCase());
  }
  return [...out];
}

/**
 * Pick the best email for a company whose website host is `siteHost`.
 * Preference: nominative on the company domain > generic on the company
 * domain > (nothing). Off-domain addresses are discarded — an agency's or a
 * partner's email in a footer is worse than no email in a CRM.
 */
export function pickEmail(
  emails: string[],
  siteHost: string,
): { email: string | null; kind: EmailKind } {
  const bare = siteHost.replace(/^www\./, "").toLowerCase();
  const onDomain = emails.filter((e) => e.split("@")[1] === bare);
  const nominative = onDomain.find((e) => !GENERIC_LOCALPART.test(e.split("@")[0]));
  if (nominative) return { email: nominative, kind: "NOMINATIVE" };
  if (onDomain[0]) return { email: onDomain[0], kind: "GENERIC" };
  return { email: null, kind: "NONE" };
}

// --- speciality inference (maps to Company.specialite* booleans) -------------
const SPECIALITY_KEYWORDS: Record<string, RegExp> = {
  sante: /\b(sante|mutuelle|complementaire sante|frais de sante)\b/,
  prevoyance: /\bprevoyance\b/,
  iard: /\b(iard|dommages?|multirisques?|habitation)\b/,
  auto: /\b(auto(mobile)?s?|flottes?|vehicules?)\b/,
  rcPro: /\b(rc pro|responsabilite civile|decennale)\b/,
  entreprises: /\b(entreprises?|professionnels?|tpe|pme|artisans?|commercants?)\b/,
  collectives: /\b(collectives?|collectifs?|sante collective|retraite collective)\b/,
  particuliers: /\bparticuliers?\b/,
};

function deburr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function detectSpecialites(text: string): Record<string, boolean> {
  const t = deburr(text);
  const out: Record<string, boolean> = {};
  for (const [key, re] of Object.entries(SPECIALITY_KEYWORDS)) {
    if (re.test(t)) out[key] = true;
  }
  return out;
}

// --- robots.txt (minimal: Disallow rules of the "*" group) -------------------
async function disallowedPaths(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const txt = await res.text();
    const rules: string[] = [];
    let applies = false;
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      const ua = line.match(/^user-agent:\s*(.+)$/i);
      if (ua) {
        applies = ua[1].trim() === "*";
        continue;
      }
      if (!applies) continue;
      const dis = line.match(/^disallow:\s*(.*)$/i);
      if (dis && dis[1]) rules.push(dis[1].trim());
    }
    return rules;
  } catch {
    return []; // unreachable robots.txt → default allow, stay polite anyway
  }
}

function isAllowed(path: string, rules: string[]): boolean {
  const p = path === "" ? "/" : path;
  return !rules.some((r) => r !== "" && p.startsWith(r.replace(/\*+$/, "")));
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface CrawlResult {
  email: string | null;
  emailKind: EmailKind;
  phone: string | null;
  specialites: Record<string, boolean>;
  pagesFetched: number;
  // Ownership check: did any fetched page mention the expected SIREN/SIRET or
  // company name? Mentions légales must list them, so a site that never does
  // is almost certainly NOT the company's site (wrong search match).
  verified: boolean;
}

export interface CrawlExpectation {
  siren?: string | null;
  name?: string | null;
}

function normalizeLoose(s: string): string {
  return deburr(s).replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function pageMentionsOwner(html: string, expect: CrawlExpectation): boolean {
  if (expect.siren) {
    // SIREN/SIRET appear spaced or dotted ("443 061 841") — compare digits only.
    if (html.replace(/\D+/g, "").includes(expect.siren)) return true;
  }
  if (expect.name) {
    const name = normalizeLoose(expect.name);
    if (name.length >= 5 && normalizeLoose(html).includes(name)) return true;
  }
  return false;
}

export async function crawlSite(
  siteWeb: string,
  expect?: CrawlExpectation,
): Promise<CrawlResult> {
  const empty: CrawlResult = {
    email: null,
    emailKind: "NONE",
    phone: null,
    specialites: {},
    pagesFetched: 0,
    verified: !expect,
  };
  let origin: string;
  let host: string;
  try {
    const u = new URL(siteWeb.startsWith("http") ? siteWeb : `https://${siteWeb}`);
    origin = u.origin;
    host = u.hostname;
  } catch {
    return empty;
  }

  const rules = await disallowedPaths(origin);
  const emails: string[] = [];
  let phone: string | null = null;
  let specialites: Record<string, boolean> = {};
  let pagesFetched = 0;
  let verified = !expect;

  for (const path of PATHS) {
    if (!isAllowed(path, rules)) continue;
    // Stop early once we have everything a page could still add.
    if (verified && phone && emails.some((e) => !GENERIC_LOCALPART.test(e.split("@")[0])))
      break;
    if (pagesFetched > 0) await sleep(DELAY_MS);
    const html = await fetchHtml(origin + path);
    if (!html) continue;
    pagesFetched++;
    if (!verified && expect) verified = pageMentionsOwner(html, expect);
    emails.push(...extractAllEmails(html));
    phone = phone ?? extractPhone(html);
    specialites = { ...specialites, ...detectSpecialites(html) };
  }

  const picked = pickEmail([...new Set(emails)], host);
  return {
    email: picked.email,
    emailKind: picked.kind,
    phone,
    specialites,
    pagesFetched,
    verified,
  };
}

/** Money formatter — euros (Int) → "1 250 €". Used across the Finances cockpit. */
export function formatCurrency(
  amount: number | null | undefined,
  currency = "EUR",
): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Money formatter — integer minor units → "1 250,00 €". The Chronos counterpart
 * to formatCurrency above (S27).
 *
 * Deliberately a separate function rather than a flag on formatCurrency: that
 * one takes WHOLE euros and pins maximumFractionDigits to 0, so feeding it
 * cents renders 100× too large, and it has eight call sites whose contract must
 * not shift. Chronos money is always cents and wants the decimals — a margin
 * that doesn't reconcile to the cent against a marketplace statement is useless.
 */
export function formatCents(
  cents: number | null | undefined,
  currency = "EUR",
): string {
  if (cents == null || Number.isNaN(cents)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Percentage formatter — "29,2 %". The Chronos margin percentages are exact
 * ratios (netMargin / revenue × 100), deliberately unrounded in margin.ts so
 * the maths stays lossless; rounding is a display concern and belongs here.
 */
export function formatPct(
  pct: number | null | undefined,
  digits = 1,
): string {
  if (pct == null || Number.isNaN(pct)) return "—";
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(pct)} %`;
}

export function companyName(c: {
  nomSociete?: string | null;
  enseigne?: string | null;
  siret?: string | null;
}): string {
  return (
    c.nomSociete?.trim() ||
    c.enseigne?.trim() ||
    (c.siret ? `SIRET ${c.siret}` : "Société sans nom")
  );
}

export function contactName(c: {
  prenom?: string | null;
  nom?: string | null;
}): string {
  const full = [c.prenom, c.nom].filter(Boolean).join(" ").trim();
  return full || "Contact sans nom";
}

/** LinkedIn "people" search URL — one click to find a person at a company. */
export function personLinkedInSearch(
  contact: { prenom?: string | null; nom?: string | null },
  company?: { nomSociete?: string | null; enseigne?: string | null; ville?: string | null },
): string {
  const terms = [
    contact.prenom,
    contact.nom,
    company?.nomSociete || company?.enseigne,
    company?.ville,
  ]
    .filter(Boolean)
    .join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(terms)}`;
}

/** LinkedIn "companies" search URL. */
export function companyLinkedInSearch(company: {
  nomSociete?: string | null;
  enseigne?: string | null;
  ville?: string | null;
}): string {
  const terms = [company.nomSociete || company.enseigne, company.ville]
    .filter(Boolean)
    .join(" ");
  return `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(terms)}`;
}

/** Extract a bare domain from a website URL (for building email suggestions). */
export function domainFromWebsite(siteWeb?: string | null): string | null {
  if (!siteWeb) return null;
  try {
    const u = new URL(siteWeb.startsWith("http") ? siteWeb : `https://${siteWeb}`);
    return u.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");

/** Best-guess professional email (prenom.nom@domain). Clearly a suggestion. */
export function suggestedEmail(
  contact: { prenom?: string | null; nom?: string | null },
  domain: string | null,
): string | null {
  if (!domain || (!contact.prenom && !contact.nom)) return null;
  const clean = (v?: string | null) =>
    stripAccents((v ?? "").toLowerCase())
      .replace(/[^a-z-]/g, "")
      .trim();
  const prenom = clean(contact.prenom);
  const nom = clean(contact.nom);
  if (prenom && nom) return `${prenom}.${nom}@${domain}`;
  return `${prenom || nom}@${domain}`;
}

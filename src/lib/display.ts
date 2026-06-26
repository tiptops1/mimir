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

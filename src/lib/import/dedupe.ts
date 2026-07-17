import { createHash } from "node:crypto";
import { normalizeCompanyName, normalizeDomain } from "@/lib/dedupe";

// S13b — import-time dedupe decisions. Pure (node:crypto only — server/test
// side; the client wizard never imports this). SIRET is the hard key;
// name/domain matches are hints surfaced in the dry-run report, never blocks
// (the conservative-exact-match philosophy of src/lib/dedupe.ts).

export type SiretStatus =
  | { kind: "valid"; siret: string }
  | { kind: "missing" }
  | { kind: "invalid"; raw: string };

/** Clean + validate a SIRET cell: 14 digits after stripping spaces/dots. */
export function siretStatus(raw: string | null | undefined): SiretStatus {
  const t = (raw ?? "").trim();
  if (!t || t === "[ND]") return { kind: "missing" };
  const digits = t.replace(/[\s.]/g, "");
  return /^\d{14}$/.test(digits)
    ? { kind: "valid", siret: digits }
    : { kind: "invalid", raw: t };
}

/**
 * Deterministic placeholder for SIRET-less rows: same normalized name + code
 * postal → same key, so re-runs (and duplicate rows within one file) converge
 * on one company. Extends the baseline's "MANUEL-…" placeholder precedent.
 */
export function placeholderSiret(
  name: string | null | undefined,
  codePostal: string | null | undefined,
): string {
  const fingerprint = `${normalizeCompanyName(name)}|${(codePostal ?? "").trim()}`;
  return `IMPORT-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 12)}`;
}

export type RowKeyResult =
  | { ok: true; rowKey: string; placeholder: boolean }
  | { ok: false; error: string };

/** Company upsert key for a row: real SIRET, else deterministic placeholder. */
export function computeRowKey(company: {
  siret?: unknown;
  nomSociete?: unknown;
  enseigne?: unknown;
  codePostal?: unknown;
}): RowKeyResult {
  const status = siretStatus(company.siret as string | null | undefined);
  if (status.kind === "valid") {
    return { ok: true, rowKey: status.siret, placeholder: false };
  }
  if (status.kind === "invalid") {
    return {
      ok: false,
      error: `SIRET invalide : « ${status.raw} » (14 chiffres attendus).`,
    };
  }
  const name = (company.nomSociete ?? company.enseigne) as string | null | undefined;
  if (!name || !normalizeCompanyName(name)) {
    return {
      ok: false,
      error: "Ligne sans SIRET ni raison sociale — impossible d'identifier la société.",
    };
  }
  return {
    ok: true,
    rowKey: placeholderSiret(name, company.codePostal as string | null | undefined),
    placeholder: true,
  };
}

export interface DedupeHint {
  kind: "name" | "domain";
  companyId: string;
  label: string;
}

/**
 * Snapshot of the tenant's existing companies the job builds once, then keeps
 * current while planning (created rowKeys are added as rows are planned, so
 * duplicate rows within one file converge without a DB round-trip each).
 */
export interface ExistingIndex {
  /** siret → companyId ("" for rows planned this run but not yet created). */
  sirets: Map<string, string>;
  byNameNorm: Map<string, { id: string; label: string }>;
  byDomain: Map<string, { id: string; label: string }>;
}

export function buildExistingIndex(
  companies: Array<{
    id: string;
    siret: string;
    nomSociete: string | null;
    enseigne: string | null;
    siteWeb: string | null;
  }>,
): ExistingIndex {
  const index: ExistingIndex = {
    sirets: new Map(),
    byNameNorm: new Map(),
    byDomain: new Map(),
  };
  for (const c of companies) {
    const label = c.enseigne || c.nomSociete || c.siret;
    index.sirets.set(c.siret, c.id);
    const nameNorm = normalizeCompanyName(c.enseigne || c.nomSociete);
    if (nameNorm.length >= 5 && !index.byNameNorm.has(nameNorm)) {
      index.byNameNorm.set(nameNorm, { id: c.id, label });
    }
    const domain = normalizeDomain(c.siteWeb);
    if (domain && !index.byDomain.has(domain)) {
      index.byDomain.set(domain, { id: c.id, label });
    }
  }
  return index;
}

export type PlannedAction = "CREATE" | "UPDATE" | "SKIP";

export interface RowPlan {
  action: PlannedAction;
  existingCompanyId: string | null;
  hints: DedupeHint[];
}

/**
 * Decide what to do with a row given the existing index and the run's
 * duplicate policy. "skip" preserves enriched data (dedup-and-import.ts
 * behavior); "fillEmpty" updates only null/empty fields at commit time.
 * The caller must register CREATE results via `registerPlanned` so later
 * duplicate rows in the same file resolve to SKIP.
 */
export function planRow(
  rowKey: string,
  company: { nomSociete?: unknown; enseigne?: unknown; siteWeb?: unknown },
  index: ExistingIndex,
  policy: "skip" | "fillEmpty",
): RowPlan {
  const existingId = index.sirets.get(rowKey);
  if (existingId !== undefined) {
    return {
      action: policy === "fillEmpty" && existingId !== "" ? "UPDATE" : "SKIP",
      existingCompanyId: existingId || null,
      hints: [],
    };
  }

  const hints: DedupeHint[] = [];
  const nameNorm = normalizeCompanyName(
    (company.enseigne ?? company.nomSociete) as string | null | undefined,
  );
  if (nameNorm.length >= 5) {
    const byName = index.byNameNorm.get(nameNorm);
    if (byName) hints.push({ kind: "name", companyId: byName.id, label: byName.label });
  }
  const domain = normalizeDomain(company.siteWeb as string | null | undefined);
  if (domain) {
    const byDomain = index.byDomain.get(domain);
    if (byDomain) hints.push({ kind: "domain", companyId: byDomain.id, label: byDomain.label });
  }
  return { action: "CREATE", existingCompanyId: null, hints };
}

/** Register a planned CREATE so later rows with the same key SKIP. */
export function registerPlanned(index: ExistingIndex, rowKey: string): void {
  if (!index.sirets.has(rowKey)) index.sirets.set(rowKey, "");
}

/** Contact dedupe within a company: email first, else nom+prenom fingerprint. */
export function shouldSkipContact(
  contact: { nom?: unknown; prenom?: unknown; email?: unknown },
  existing: Array<{ nom: string | null; prenom: string | null; email: string | null }>,
): boolean {
  const email = typeof contact.email === "string" ? contact.email.trim().toLowerCase() : "";
  if (email) {
    if (existing.some((c) => (c.email ?? "").trim().toLowerCase() === email)) return true;
  }
  const fp = `${String(contact.nom ?? "").trim().toLowerCase()}::${String(contact.prenom ?? "").trim().toLowerCase()}`;
  if (fp === "::") return false;
  return existing.some(
    (c) => `${(c.nom ?? "").trim().toLowerCase()}::${(c.prenom ?? "").trim().toLowerCase()}` === fp,
  );
}

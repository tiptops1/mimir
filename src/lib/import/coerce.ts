import type {
  ColumnMapping,
  ImportTarget,
  ImportMappingConfig,
} from "./mapping";
import { resolveTarget } from "./mapping";

// S13b — cell coercion + row → entity payload assembly. Pure. Coercers
// promoted from scripts/dedup-and-import.ts; stage mapping is config-driven
// (StageDefinition labels) instead of that script's hardcoded STAGE_MAP.

export const clean = (v: string | undefined): string | null => {
  if (v === undefined) return null;
  const t = v.trim();
  if (!t || t === "[ND]") return null;
  return t;
};

/** ISO dates plus the French dd/mm/yyyy (and dd/mm/yy) export format. */
export const toDate = (v: string | undefined): Date | null => {
  const t = clean(v);
  if (!t) return null;
  const fr = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (fr) {
    const [, dd, mm, yy] = fr;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
    return d.getUTCMonth() === Number(mm) - 1 && d.getUTCDate() === Number(dd)
      ? d
      : null;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Integers with spaces / thin spaces / "€" tolerated ("1 200 €" → 1200). */
export const toInt = (v: string | undefined): number | null => {
  const t = clean(v);
  if (!t) return null;
  const digits = t.replace(/[\s  €]/g, "").replace(/,\d+$/, "");
  if (!/^-?\d+$/.test(digits)) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isNaN(n) ? null : n;
};

export const toBool = (v: string | undefined): boolean => {
  const t = clean(v)?.toLowerCase();
  return t === "oui" || t === "true" || t === "1" || t === "x" || t === "yes";
};

export interface StageDefLite {
  key: string;
  label: string;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Source stage label → tenant StageDefinition key (config-driven). Matches
 * the normalized label or the key itself; unknown → null (caller applies the
 * tenant default stage).
 */
export function stageKeyFromLabel(
  raw: string | undefined,
  stages: StageDefLite[],
): string | null {
  const t = clean(raw);
  if (!t) return null;
  const norm = normalize(t);
  for (const s of stages) {
    if (normalize(s.label) === norm || normalize(s.key) === norm) return s.key;
  }
  return null;
}

export interface RowPayloads {
  company: Record<string, unknown>;
  companyCustom: Record<string, unknown>;
  contact: Record<string, unknown>;
  contactCustom: Record<string, unknown>;
  deal: Record<string, unknown>;
  dealCustom: Record<string, unknown>;
  /** Free-text values (notes, CUSTOM text fields) — health-classifier input. */
  textFields: string[];
  errors: string[];
}

function coerceCell(
  target: ImportTarget,
  raw: string | undefined,
  stages: StageDefLite[],
): unknown {
  switch (target.type) {
    case "number":
      return toInt(raw);
    case "bool":
      return toBool(raw);
    case "date":
      return toDate(raw);
    case "stage":
      return stageKeyFromLabel(raw, stages);
    default:
      return clean(raw);
  }
}

/**
 * One CSV row → per-entity payloads. NATIVE targets land on the payload
 * directly; CUSTOM targets land on the entity's customFields map. Coercion is
 * lenient (unparseable cell → null, CSVs are messy); structural problems go to
 * `errors`. Free-text values are ALSO kept out of the payloads' caller-visible
 * text bundle only via `textFields` — the job strips them when quarantined.
 */
export function buildRowPayloads(
  cells: string[],
  columns: ImportMappingConfig["columns"],
  catalog: ImportTarget[],
  stages: StageDefLite[],
): RowPayloads {
  const out: RowPayloads = {
    company: {},
    companyCustom: {},
    contact: {},
    contactCustom: {},
    deal: {},
    dealCustom: {},
    textFields: [],
    errors: [],
  };

  columns.forEach((col: ColumnMapping, i: number) => {
    if (!col.target) return;
    const target = resolveTarget(catalog, col.target);
    if (!target) {
      out.errors.push(`Colonne « ${col.header} » : champ cible inconnu (${col.target.entity}.${col.target.key}).`);
      return;
    }
    const value = coerceCell(target, cells[i], stages);
    if (value === null || value === undefined) return;

    const bucket =
      target.entity === "COMPANY"
        ? target.source === "NATIVE"
          ? out.company
          : out.companyCustom
        : target.entity === "CONTACT"
          ? target.source === "NATIVE"
            ? out.contact
            : out.contactCustom
          : target.source === "NATIVE"
            ? out.deal
            : out.dealCustom;
    bucket[target.key] = value;

    if (target.freeText && typeof value === "string") {
      out.textFields.push(value);
    }
  });

  return out;
}

/** Keys of mapped free-text targets — what gets stripped on quarantine. */
export function freeTextKeys(
  columns: ImportMappingConfig["columns"],
  catalog: ImportTarget[],
): Array<{ entity: ImportTarget["entity"]; key: string; source: "NATIVE" | "CUSTOM" }> {
  const keys: Array<{ entity: ImportTarget["entity"]; key: string; source: "NATIVE" | "CUSTOM" }> = [];
  for (const col of columns) {
    if (!col.target) continue;
    const target = resolveTarget(catalog, col.target);
    if (target?.freeText) {
      keys.push({ entity: target.entity, key: target.key, source: target.source });
    }
  }
  return keys;
}

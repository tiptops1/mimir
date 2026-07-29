import type { Prisma } from "@prisma/client";
import { str, ci, type Sp } from "@/lib/list-filters";
import { ageingBucketFor } from "./margin";
import type { UnitMarginRow } from "./inventory";

/**
 * Chronos (S27b) — filtering and sorting for the inventory list.
 *
 * Deliberately pure (type-only Prisma import, no client, no I/O) so the derived
 * predicates are unit-testable — same posture as margin.ts and thor/health.ts.
 *
 * The split matters: `buildUnitWhere` covers everything Prisma can express and
 * runs in the query; `filterUnitRows`/`sortUnitRows` cover everything computed
 * from the cost ledger, which Prisma cannot see at all. Anything the derived
 * half touches makes `count` and skip/take properties of the FILTERED array,
 * never of the collection.
 */

/** Units still in stock — see UNSOLD_WHERE in inventory.ts for the isSet rule. */
const UNSOLD: Prisma.InventoryUnitWhereInput = {
  OR: [{ soldAt: null }, { soldAt: { isSet: false } }],
};

export function buildUnitWhere(sp: Sp): Prisma.InventoryUnitWhereInput {
  const sku = str(sp, "sku");
  const ref = str(sp, "ref");
  const serie = str(sp, "serie");
  const statut = str(sp, "statut");
  const dispo = str(sp, "dispo");
  const canal = str(sp, "canal");
  const fournisseur = str(sp, "fournisseur");

  const and: Prisma.InventoryUnitWhereInput[] = [];

  if (sku) and.push({ sku: ci(sku) });
  // One box over the whole catalog identity — brand, reference and model are
  // the same lookup in the operator's head ("Seiko SKX007").
  if (ref) {
    and.push({
      ref: {
        is: {
          OR: [
            { brand: ci(ref) },
            { reference: ci(ref) },
            { model: ci(ref) },
            { variant: ci(ref) },
          ],
        },
      },
    });
  }
  if (serie) and.push({ serial: ci(serie) });
  if (statut) and.push({ status: statut });
  if (fournisseur) and.push({ supplier: ci(fournisseur) });
  if (canal) and.push({ soldOn: canal });
  if (dispo === "stock") and.push(UNSOLD);
  if (dispo === "vendue") and.push({ soldAt: { not: null } });

  return and.length > 0 ? { AND: and } : {};
}

/** Derived predicates — none of these exist as a stored column. */
export function filterUnitRows(
  rows: UnitMarginRow[],
  sp: Sp,
  targetMarginPct: number,
): UnitMarginRow[] {
  const marge = str(sp, "marge");
  const age = str(sp, "age");

  return rows.filter(({ margin }) => {
    if (marge === "perte" && !(margin.sold && margin.netMarginCents < 0)) {
      return false;
    }
    // "Under target" is about sold units only: an unsold unit has no margin %
    // yet, and counting it as 0% would flood the list with everything in stock.
    if (marge === "sousObjectif") {
      if (!margin.sold || margin.marginPct === null) return false;
      if (margin.marginPct >= targetMarginPct) return false;
    }
    // Ageing is a property of stock, exactly as in summarizeMargins: a sold
    // unit ties up no capital, so it belongs to no bucket.
    if (age && (margin.sold || ageingBucketFor(margin.daysHeld) !== age)) {
      return false;
    }
    return true;
  });
}

export type UnitSortKey =
  | "acquisition"
  | "marge"
  | "margePct"
  | "margeJour"
  | "duree"
  | "capital";

export const UNIT_SORTS: { value: UnitSortKey; label: string }[] = [
  { value: "acquisition", label: "Acquisition (récent)" },
  { value: "marge", label: "Marge nette" },
  { value: "margePct", label: "Marge %" },
  { value: "margeJour", label: "Marge / jour" },
  { value: "duree", label: "Jours détenus" },
  { value: "capital", label: "Capital immobilisé" },
];

/**
 * Sort descending on a derived measure. Rows with no value for the measure —
 * an unsold unit has no margin % and no margin/day — always sort LAST rather
 * than as 0, so "best margin per day" doesn't open on a page of stock.
 */
export function sortUnitRows(
  rows: UnitMarginRow[],
  key: string,
): UnitMarginRow[] {
  // Prisma already returned newest-acquisition-first; don't re-sort it.
  if (key === "" || key === "acquisition") return rows;

  const measure = (row: UnitMarginRow): number | null => {
    const m = row.margin;
    switch (key) {
      case "marge":
        return m.sold ? m.netMarginCents : null;
      case "margePct":
        return m.marginPct;
      case "margeJour":
        return m.marginPerDayCents;
      case "duree":
        return m.daysHeld;
      case "capital":
        return m.cashTiedUpCents;
      default:
        return null;
    }
  };

  // Decorate-sort-undecorate keeps the comparator total and the sort stable
  // across engines even when every measure is null.
  return rows
    .map((row, index) => ({ row, index, value: measure(row) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      if (a.value !== b.value) return b.value - a.value;
      return a.index - b.index;
    })
    .map((d) => d.row);
}

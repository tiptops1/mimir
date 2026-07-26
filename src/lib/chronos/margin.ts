// Chronos (S27) — pure true-margin math. No Prisma import here (same posture as
// src/lib/thor/health.ts and src/lib/freyja/metrics.ts) so this stays unit
// testable without a tenant connection, and stays importable from scripts/.
// The Prisma half is inventory.ts, which maps rows into the inputs below.
//
// NOT TAX ADVICE. The VAT scheme and rate are tenant config (ChronosConfig),
// never code, and the second-hand margin scheme has conditions this module does
// not verify. v1 simplification, stated explicitly: input VAT on restoration
// parts is not reclaimable under the margin scheme, and no reclaim is modelled.
// A tenant should confirm the scheme with their accountant before trusting
// these figures for a return.
//
// ALL money is integer minor units (cents) of ChronosConfig.baseCurrency.

/** Ageing buckets for cash tied up in unsold stock, in days held. */
export const AGEING_BUCKET_DAYS = [30, 90] as const;

/**
 * Cost kinds bucketed for the margin waterfall. Open vocab: a `kind` not listed
 * here is summed into `other` rather than dropped, so an unrecognised line can
 * never silently vanish from the total.
 */
export const COST_GROUPS = {
  acquisition: ["ACQUISITION"],
  restoration: ["PART", "CONSUMABLE", "LABOUR", "TOOL_ALLOCATION"],
  logistics: ["SHIPPING_IN", "SHIPPING_OUT", "DUTY"],
  fees: ["MARKETPLACE_FEE", "PAYMENT_FEE"],
  // A return silently wipes a unit's margin, so refunds are their own group
  // rather than being buried in `other`.
  refunds: ["REFUND"],
} as const;

export type CostGroup = keyof typeof COST_GROUPS | "other";

const KIND_TO_GROUP: Record<string, CostGroup> = Object.fromEntries(
  Object.entries(COST_GROUPS).flatMap(([group, kinds]) =>
    kinds.map((kind) => [kind, group as CostGroup]),
  ),
);

export function groupForKind(kind: string): CostGroup {
  return KIND_TO_GROUP[kind] ?? "other";
}

export type VatScheme = "MARGIN" | "STANDARD" | "EXEMPT";

export interface UnitCostInput {
  kind: string;
  /** Always positive, already converted to base currency. */
  baseAmountCents: number;
}

export interface UnitMarginInput {
  unitId: string;
  sku: string;
  acquiredAt: Date | null;
  soldAt: Date | null;
  /** In the sale currency; converted with saleFxRate. */
  salePriceCents: number | null;
  /** Multiplier to base currency. Null/0 is treated as 1:1. */
  saleFxRate: number | null;
  vatScheme: VatScheme;
  vatRatePct: number;
  costs: UnitCostInput[];
}

export interface UnitMargin {
  unitId: string;
  sku: string;
  sold: boolean;
  revenueCents: number;
  /** Per-group cost subtotals — the margin waterfall's rows. */
  groups: Record<CostGroup, number>;
  totalCostCents: number;
  vatCents: number;
  netMarginCents: number;
  /** Null when there is no revenue to take a percentage of. */
  marginPct: number | null;
  /** Acquisition → sale for a sold unit, acquisition → now for one in stock. */
  daysHeld: number | null;
  /**
   * Net margin per day of capital held — the metric that actually governs a
   * flipper's business, since 40% over eight months is worse than 18% over six
   * weeks. Null until the unit is sold; there is no realised margin before then.
   */
  marginPerDayCents: number | null;
  /** Cost sunk into a unit still in stock. 0 once sold. */
  cashTiedUpCents: number;
}

const MS_PER_DAY = 86_400_000;

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY));
}

/**
 * VAT under the second-hand margin scheme.
 *
 * The margin is VAT-INCLUSIVE, so the rate is applied as rate/(100+rate), not
 * rate/100 — the latter overstates VAT by the rate itself (~23% too much at the
 * Irish standard rate). This is the single easiest thing in this domain to get
 * quietly wrong, which is why it is its own exported function with its own tests.
 *
 * Returns 0 on a break-even or loss-making sale: there is no margin to tax.
 */
export function marginSchemeVatCents(
  revenueCents: number,
  acquisitionCents: number,
  vatRatePct: number,
): number {
  if (vatRatePct <= 0) return 0;
  const margin = revenueCents - acquisitionCents;
  if (margin <= 0) return 0;
  return Math.round((margin * vatRatePct) / (100 + vatRatePct));
}

/** VAT on the full sale price, also VAT-inclusive (a gross price is quoted). */
function standardVatCents(revenueCents: number, vatRatePct: number): number {
  if (vatRatePct <= 0 || revenueCents <= 0) return 0;
  return Math.round((revenueCents * vatRatePct) / (100 + vatRatePct));
}

function emptyGroups(): Record<CostGroup, number> {
  return { acquisition: 0, restoration: 0, logistics: 0, fees: 0, refunds: 0, other: 0 };
}

/**
 * The whole margin picture for one unit. Pure — same `now` in, same result out.
 */
export function computeUnitMargin(
  input: UnitMarginInput,
  now: Date = new Date(),
): UnitMargin {
  const groups = emptyGroups();
  for (const cost of input.costs) {
    groups[groupForKind(cost.kind)] += cost.baseAmountCents;
  }
  const totalCostCents = Object.values(groups).reduce((sum, v) => sum + v, 0);

  const sold = input.soldAt != null;
  const fx = input.saleFxRate && input.saleFxRate > 0 ? input.saleFxRate : 1;
  const revenueCents =
    input.salePriceCents != null ? Math.round(input.salePriceCents * fx) : 0;

  let vatCents = 0;
  if (revenueCents > 0) {
    if (input.vatScheme === "MARGIN") {
      vatCents = marginSchemeVatCents(revenueCents, groups.acquisition, input.vatRatePct);
    } else if (input.vatScheme === "STANDARD") {
      vatCents = standardVatCents(revenueCents, input.vatRatePct);
    }
    // EXEMPT: 0.
  }

  const netMarginCents = revenueCents - totalCostCents - vatCents;
  const marginPct =
    revenueCents > 0 ? (netMarginCents / revenueCents) * 100 : null;

  let daysHeld: number | null = null;
  if (input.acquiredAt) {
    daysHeld = daysBetween(input.acquiredAt, sold ? input.soldAt! : now);
  }

  // A same-day flip is a real and good outcome, not a division by zero — floor
  // the denominator at one day rather than returning null.
  const marginPerDayCents =
    sold && daysHeld != null ? Math.round(netMarginCents / Math.max(1, daysHeld)) : null;

  return {
    unitId: input.unitId,
    sku: input.sku,
    sold,
    revenueCents,
    groups,
    totalCostCents,
    vatCents,
    netMarginCents,
    marginPct,
    daysHeld,
    marginPerDayCents,
    cashTiedUpCents: sold ? 0 : totalCostCents,
  };
}

export interface MarginSummary {
  unitCount: number;
  inStockCount: number;
  soldCount: number;
  /** Capital sunk into unsold stock. */
  cashTiedUpCents: number;
  /** Cash tied up split by how long it has been sitting: 0-30 / 30-90 / 90+ days. */
  ageing: { bucket: string; unitCount: number; cashTiedUpCents: number }[];
  /** Realised figures — sold units only. */
  revenueCents: number;
  totalCostCents: number;
  vatCents: number;
  netMarginCents: number;
  /** Aggregate, not a mean of percentages: net over revenue across all sales. */
  marginPct: number | null;
  /** Mean margin-per-day across sold units. Null with no sales. */
  avgMarginPerDayCents: number | null;
}

function ageingBucketFor(daysHeld: number | null): string {
  const [near, mid] = AGEING_BUCKET_DAYS;
  if (daysHeld == null || daysHeld < near) return `0-${near}`;
  if (daysHeld < mid) return `${near}-${mid}`;
  return `${mid}+`;
}

/** Cockpit-level rollup. Realised money counts only sold units. */
export function summarizeMargins(margins: UnitMargin[]): MarginSummary {
  const sold = margins.filter((m) => m.sold);
  const inStock = margins.filter((m) => !m.sold);

  const [near, mid] = AGEING_BUCKET_DAYS;
  const buckets = [`0-${near}`, `${near}-${mid}`, `${mid}+`];
  const ageing = buckets.map((bucket) => {
    const rows = inStock.filter((m) => ageingBucketFor(m.daysHeld) === bucket);
    return {
      bucket,
      unitCount: rows.length,
      cashTiedUpCents: rows.reduce((s, m) => s + m.cashTiedUpCents, 0),
    };
  });

  const revenueCents = sold.reduce((s, m) => s + m.revenueCents, 0);
  const netMarginCents = sold.reduce((s, m) => s + m.netMarginCents, 0);
  const perDay = sold
    .map((m) => m.marginPerDayCents)
    .filter((v): v is number => v != null);

  return {
    unitCount: margins.length,
    inStockCount: inStock.length,
    soldCount: sold.length,
    cashTiedUpCents: inStock.reduce((s, m) => s + m.cashTiedUpCents, 0),
    ageing,
    revenueCents,
    totalCostCents: sold.reduce((s, m) => s + m.totalCostCents, 0),
    vatCents: sold.reduce((s, m) => s + m.vatCents, 0),
    netMarginCents,
    marginPct: revenueCents > 0 ? (netMarginCents / revenueCents) * 100 : null,
    avgMarginPerDayCents:
      perDay.length > 0
        ? Math.round(perDay.reduce((s, v) => s + v, 0) / perDay.length)
        : null,
  };
}

export interface MarketplaceFeeModel {
  finalValuePct?: number;
  fixedCents?: number;
  paymentPct?: number;
  regulatoryPct?: number;
}

/**
 * Estimated marketplace + payment fees on a sale price. Used to project margin
 * on a unit not yet sold; once S29 syncs a real order, the actual fee lines land
 * as UnitCost rows and supersede this estimate entirely.
 */
export function estimateFees(
  salePriceCents: number,
  fees: MarketplaceFeeModel | undefined,
): number {
  if (!fees || salePriceCents <= 0) return 0;
  const pct =
    (fees.finalValuePct ?? 0) + (fees.paymentPct ?? 0) + (fees.regulatoryPct ?? 0);
  return Math.round((salePriceCents * pct) / 100) + (fees.fixedCents ?? 0);
}

/**
 * Parse a human-entered money string to integer cents.
 *
 * Accepts both the French "1 234,56" (comma decimal, space/nbsp thousands) and
 * the plain "1234.56" forms, plus a bare number. Returns null on anything it
 * cannot parse — callers must reject rather than book a silent 0.
 */
export function toCents(input: string | number): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  const cleaned = input
    .replace(/[\s  ]/g, "")
    .replace(/[€$£]/g, "")
    .replace(",", ".");
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned)) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  // Round the scaled value, not the parsed float: 19.99 * 100 is 1998.9999...
  return Math.round(value * 100);
}

// Chronos — finance rollups. Pure, no Prisma import (same posture as margin.ts,
// which it builds on), so it stays unit-testable without a tenant connection.
// The Prisma half is inventory.ts; the page maps its rows into the plain-data
// `SoldUnit` input below.
//
// ALL money is integer minor units (cents) of ChronosConfig.baseCurrency.
//
// One semantic runs through everything here and is easy to get wrong:
//
//   REALISED figures (revenue, cost of goods, VAT, net margin) are attributed to
//   the month a unit SOLD, and are filtered by the selected period.
//   POSITION figures (cash tied up, ageing) describe stock as it stands RIGHT
//   NOW and are never period-filtered — a watch bought three years ago is still
//   your money today, and hiding it because it falls outside a 12-month window
//   would understate the one number that governs the business.

import { ageingBucketFor, type CostGroup, type UnitMargin } from "./margin";

/** A unit's margin paired with the two sale facts margin.ts doesn't carry. */
export interface SoldUnit {
  unitId: string;
  sku: string;
  /** Null while in stock. */
  soldAt: Date | null;
  /** ChronosConfig.marketplaces key. Null for a direct/off-platform sale. */
  soldOn: string | null;
  margin: UnitMargin;
}

export type FinancePeriod = "3m" | "12m" | "24m" | "tout";

export const FINANCE_PERIODS: { key: FinancePeriod; label: string }[] = [
  { key: "3m", label: "3 mois" },
  { key: "12m", label: "12 mois" },
  { key: "24m", label: "24 mois" },
  { key: "tout", label: "Tout" },
];

export function isFinancePeriod(v: string): v is FinancePeriod {
  return FINANCE_PERIODS.some((p) => p.key === v);
}

/** Months in a period window, or null for "tout" (no lower bound). */
function monthsIn(period: FinancePeriod): number | null {
  return period === "tout" ? null : Number.parseInt(period, 10);
}

/**
 * First instant included in the period — the start of the month `n-1` months
 * back, so "3 mois" means three whole month columns ending with the current
 * one, not a rolling 90 days that cuts the oldest column in half.
 */
export function periodStart(period: FinancePeriod, now: Date): Date | null {
  const months = monthsIn(period);
  if (months == null) return null;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
}

/** Sold units inside the window. Order preserved. */
export function inPeriod(units: SoldUnit[], start: Date | null): SoldUnit[] {
  return units.filter(
    (u) => u.soldAt != null && (start == null || u.soldAt.getTime() >= start.getTime()),
  );
}

/* ------------------------------------------------------------------ P&L --- */

export interface MonthPoint {
  /** "2026-07" — sortable, locale-free. */
  month: string;
  /** "juil. 26" — what the axis shows. */
  label: string;
  soldCount: number;
  revenueCents: number;
  /** Every cost booked against the units sold that month. */
  costCents: number;
  vatCents: number;
  netMarginCents: number;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

/**
 * Month-by-month P&L over sold units.
 *
 * Empty months are emitted, not skipped: a gap in the bars is the signal that
 * nothing sold, and a chart that silently closes it draws a flattering lie.
 * The series always ends on the current month, and starts at `start` (or the
 * earliest sale when the period is "tout").
 */
export function monthlyPnl(
  units: SoldUnit[],
  opts: { start: Date | null; now?: Date },
): MonthPoint[] {
  const now = opts.now ?? new Date();
  const sold = inPeriod(units, opts.start);

  const first =
    opts.start ??
    sold.reduce<Date | null>(
      (min, u) => (min == null || u.soldAt! < min ? u.soldAt! : min),
      null,
    );
  if (first == null) return [];

  const points = new Map<string, MonthPoint>();
  const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  const last = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  while (cursor.getTime() <= last) {
    points.set(monthKey(cursor), {
      month: monthKey(cursor),
      label: monthLabel(cursor.getUTCFullYear(), cursor.getUTCMonth()),
      soldCount: 0,
      revenueCents: 0,
      costCents: 0,
      vatCents: 0,
      netMarginCents: 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  for (const u of sold) {
    const point = points.get(monthKey(u.soldAt!));
    // A sale dated in the future (a mis-keyed year, a marketplace clock skew)
    // has no column. Dropping it silently would break the reconciliation
    // between these bars and the KPI tiles, so it lands in the last column.
    const target = point ?? [...points.values()].at(-1);
    if (!target) continue;
    target.soldCount += 1;
    target.revenueCents += u.margin.revenueCents;
    target.costCents += u.margin.totalCostCents;
    target.vatCents += u.margin.vatCents;
    target.netMarginCents += u.margin.netMarginCents;
  }

  return [...points.values()];
}

/* ------------------------------------------------------------ Breakdown --- */

/** Cost totals by waterfall group across the sold units in the period. */
export function costBreakdown(units: SoldUnit[]): Record<CostGroup, number> {
  const out: Record<CostGroup, number> = {
    acquisition: 0,
    restoration: 0,
    logistics: 0,
    fees: 0,
    refunds: 0,
    other: 0,
  };
  for (const u of units) {
    for (const [group, cents] of Object.entries(u.margin.groups)) {
      out[group as CostGroup] += cents;
    }
  }
  return out;
}

/* ---------------------------------------------------------- Marketplace --- */

export interface MarketplaceRow {
  /** ChronosConfig.marketplaces key, or "" for a direct sale. */
  key: string;
  soldCount: number;
  revenueCents: number;
  /** Marketplace + payment fees actually booked against these sales. */
  feesCents: number;
  netMarginCents: number;
  marginPct: number | null;
  /** Mean days from acquisition to sale. Null when no unit has an acquisition date. */
  avgDaysHeld: number | null;
}

/**
 * Per-channel performance, best net margin first.
 *
 * The question this answers is "which channel is actually worth listing on",
 * which is why fees are broken out rather than buried in total cost: two
 * channels at the same sale price are not the same business.
 */
export function byMarketplace(units: SoldUnit[]): MarketplaceRow[] {
  const acc = new Map<string, { row: MarketplaceRow; days: number[] }>();

  for (const u of units) {
    const key = u.soldOn ?? "";
    let entry = acc.get(key);
    if (!entry) {
      entry = {
        row: {
          key,
          soldCount: 0,
          revenueCents: 0,
          feesCents: 0,
          netMarginCents: 0,
          marginPct: null,
          avgDaysHeld: null,
        },
        days: [],
      };
      acc.set(key, entry);
    }
    entry.row.soldCount += 1;
    entry.row.revenueCents += u.margin.revenueCents;
    entry.row.feesCents += u.margin.groups.fees;
    entry.row.netMarginCents += u.margin.netMarginCents;
    if (u.margin.daysHeld != null) entry.days.push(u.margin.daysHeld);
  }

  return [...acc.values()]
    .map(({ row, days }) => ({
      ...row,
      // Aggregate, not a mean of percentages: net over revenue for the channel.
      marginPct:
        row.revenueCents > 0 ? (row.netMarginCents / row.revenueCents) * 100 : null,
      avgDaysHeld:
        days.length > 0
          ? Math.round(days.reduce((s, d) => s + d, 0) / days.length)
          : null,
    }))
    .sort((a, b) => b.netMarginCents - a.netMarginCents);
}

/* -------------------------------------------------------------- Extremes -- */

export interface UnitLine {
  unitId: string;
  sku: string;
  netMarginCents: number;
  marginPct: number | null;
  daysHeld: number | null;
}

function toLine(u: SoldUnit): UnitLine {
  return {
    unitId: u.unitId,
    sku: u.sku,
    netMarginCents: u.margin.netMarginCents,
    marginPct: u.margin.marginPct,
    daysHeld: u.margin.daysHeld,
  };
}

/**
 * The n best and n worst sales of the period.
 *
 * `worst` is not simply `best` reversed when there are fewer than 2n sales —
 * the same unit would appear in both lists. The split point keeps them disjoint.
 */
export function extremes(
  units: SoldUnit[],
  n = 5,
): { best: UnitLine[]; worst: UnitLine[] } {
  const sorted = units.map(toLine).sort((a, b) => b.netMarginCents - a.netMarginCents);
  // `split` is how many the worst half may claim; the best half then takes at
  // most everything left above it. Capping BOTH ends is what keeps them
  // disjoint — capping only `worst` still lets `best` reach down into it when
  // there are fewer than 2n sales.
  const split = Math.min(n, Math.floor(sorted.length / 2));
  return {
    best: sorted.slice(0, Math.min(n, sorted.length - split)),
    worst: split === 0 ? [] : sorted.slice(-split).reverse(),
  };
}

/* -------------------------------------------------------------- Position -- */

export interface AgeingRow {
  bucket: string;
  unitCount: number;
  cashTiedUpCents: number;
}

/**
 * Capital sitting in unsold stock, by how long it has been sitting.
 *
 * Never period-filtered — see the note at the top of this file.
 */
export function cashPosition(units: SoldUnit[]): {
  inStockCount: number;
  cashTiedUpCents: number;
  ageing: AgeingRow[];
  /** Cash in units held 90 days or more — the number that should worry someone. */
  staleCashCents: number;
} {
  const inStock = units.filter((u) => u.soldAt == null);
  const buckets = new Map<string, AgeingRow>();
  for (const u of inStock) {
    const bucket = ageingBucketFor(u.margin.daysHeld);
    const row = buckets.get(bucket) ?? { bucket, unitCount: 0, cashTiedUpCents: 0 };
    row.unitCount += 1;
    row.cashTiedUpCents += u.margin.cashTiedUpCents;
    buckets.set(bucket, row);
  }
  // Fixed order, including empty buckets: the ageing table is read as a shape,
  // and a missing middle column reads as "nothing between 30 and 90 days" only
  // if the column is actually there showing zero.
  const order = ["0-30", "30-90", "90+"];
  const ageing = order.map(
    (bucket) => buckets.get(bucket) ?? { bucket, unitCount: 0, cashTiedUpCents: 0 },
  );

  return {
    inStockCount: inStock.length,
    cashTiedUpCents: inStock.reduce((s, u) => s + u.margin.cashTiedUpCents, 0),
    ageing,
    staleCashCents: ageing.find((a) => a.bucket === "90+")?.cashTiedUpCents ?? 0,
  };
}

/* ------------------------------------------------------------------ KPIs -- */

export interface FinanceKpis {
  soldCount: number;
  revenueCents: number;
  cogsCents: number;
  vatCents: number;
  netMarginCents: number;
  marginPct: number | null;
  /** Mean realised margin per day of capital held. */
  avgMarginPerDayCents: number | null;
}

/** Realised P&L for the period. Sold units only — there is no margin before a sale. */
export function financeKpis(units: SoldUnit[]): FinanceKpis {
  const revenueCents = units.reduce((s, u) => s + u.margin.revenueCents, 0);
  const netMarginCents = units.reduce((s, u) => s + u.margin.netMarginCents, 0);
  const perDay = units
    .map((u) => u.margin.marginPerDayCents)
    .filter((v): v is number => v != null);

  return {
    soldCount: units.length,
    revenueCents,
    cogsCents: units.reduce((s, u) => s + u.margin.totalCostCents, 0),
    vatCents: units.reduce((s, u) => s + u.margin.vatCents, 0),
    netMarginCents,
    marginPct: revenueCents > 0 ? (netMarginCents / revenueCents) * 100 : null,
    avgMarginPerDayCents:
      perDay.length > 0
        ? Math.round(perDay.reduce((s, v) => s + v, 0) / perDay.length)
        : null,
  };
}

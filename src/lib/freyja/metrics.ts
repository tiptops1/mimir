// Freyja metric math (S25) — pure, no Prisma import. CPC/CPA/ROAS are always
// derived here from raw counters (never stored) so there is one source of
// truth, mirroring how AiUsage rollups live in code.

export interface RawMetrics {
  spendEur: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

export interface DerivedRates {
  cpc: number | null; // spend / clicks
  cpa: number | null; // spend / conversions
  roas: number | null; // conversionValue / spend
  ctr: number | null; // clicks / impressions
}

/** "YYYY-MM-DD" (UTC) for a Date. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The n day-keys ending yesterday (exclusive of `from`'s own day), oldest first. */
export function lastNDays(n: number, from: Date = new Date()): string[] {
  const days: string[] = [];
  for (let i = n; i >= 1; i--) {
    days.push(dayKey(new Date(from.getTime() - i * 86_400_000)));
  }
  return days;
}

/** Derived rates with zero-division -> null (an unspent campaign has no CPC). */
export function deriveRates(raw: RawMetrics): DerivedRates {
  return {
    cpc: raw.clicks > 0 ? raw.spendEur / raw.clicks : null,
    cpa: raw.conversions > 0 ? raw.spendEur / raw.conversions : null,
    roas: raw.spendEur > 0 ? raw.conversionValue / raw.spendEur : null,
    ctr: raw.impressions > 0 ? raw.clicks / raw.impressions : null,
  };
}

export interface InsightRow extends RawMetrics {
  day: string;
}

export interface CampaignAggregate {
  days: number;
  totals: RawMetrics;
  rates: DerivedRates;
  /** Trailing 7 days vs the 7 before — the fatigue-detection windows. */
  last7: RawMetrics & { rates: DerivedRates };
  prior7: RawMetrics & { rates: DerivedRates };
}

function sum(rows: InsightRow[]): RawMetrics {
  return rows.reduce(
    (acc, r) => ({
      spendEur: acc.spendEur + r.spendEur,
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      conversions: acc.conversions + r.conversions,
      conversionValue: acc.conversionValue + r.conversionValue,
    }),
    { spendEur: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 },
  );
}

/** Aggregate a campaign's insight rows (any window). Rows sorted internally by day. */
export function aggregateInsights(rows: InsightRow[]): CampaignAggregate {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const totals = sum(sorted);
  const last7Rows = sorted.slice(-7);
  const prior7Rows = sorted.slice(-14, -7);
  const last7 = sum(last7Rows);
  const prior7 = sum(prior7Rows);
  return {
    days: sorted.length,
    totals,
    rates: deriveRates(totals),
    last7: { ...last7, rates: deriveRates(last7) },
    prior7: { ...prior7, rates: deriveRates(prior7) },
  };
}

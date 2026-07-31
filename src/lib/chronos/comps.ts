// Chronos comp DB — pure band/drift math (S30).
//
// No Prisma import, same posture as margin.ts and thor/health.ts: this file is
// arithmetic over plain objects so it can be unit-tested exhaustively and
// reused from a job, a route or a page without dragging a client along.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: a band is computed over a single
// `kind`. SOLD prices (his own completed sales — authoritative) and ASK prices
// (open listings, what a seller hopes for) describe different things, and a
// large share of asks never sell at all. Averaging them produces a number that
// is neither, biased high. Every entry point here takes points already filtered
// to one kind, and `computeBand` throws if handed a mixed array rather than
// silently returning a plausible-looking wrong answer.

export type PriceKind = "SOLD" | "ASK";

export const PRICE_KINDS: PriceKind[] = ["SOLD", "ASK"];

/** Where a point came from. OWN_SALE is the only authoritative one. */
export type PriceSource = "OWN_SALE" | "BROWSE" | "MANUAL";

/** Trailing window a band is computed over. Watch prices move slowly. */
export const DEFAULT_COMP_WINDOW_DAYS = 180;

/**
 * Below this many points a band is reported but not trusted for drift.
 * Mirrors `breakerMinSample` in heimdallr/state-machine.ts — the platform's
 * existing answer to "don't act on a tiny sample".
 */
export const MIN_BAND_SAMPLE = 3;

/** Median move, in percent, that counts as the market actually shifting. */
export const DRIFT_THRESHOLD_PCT = 10;

const MS_PER_DAY = 86_400_000;

export interface PricePointInput {
  kind: PriceKind;
  /** Already converted to the tenant's base currency. */
  basePriceCents: number;
  observedAt: Date;
}

export interface PriceBand {
  kind: PriceKind;
  windowDays: number;
  sampleSize: number;
  p25Cents: number;
  medianCents: number;
  p75Cents: number;
  minCents: number;
  maxCents: number;
}

export type BandConfidence = "NONE" | "LOW" | "MEDIUM" | "HIGH";

/**
 * Convert an observed price into base-currency cents.
 *
 * Rounded once, at write time, exactly as costs.ts does for UnitCost — so a
 * band never re-derives a converted figure and lands a cent away from what is
 * stored.
 */
export function basePriceCentsOf(priceCents: number, fxRate = 1): number {
  return Math.round(priceCents * (fxRate || 1));
}

/**
 * Rate that converts `currency` into the tenant's base currency.
 *
 * Falls back to 1:1 for an unknown or non-positive rate rather than throwing:
 * a missing FX rate must not take a whole sweep down, and a same-currency
 * comparison is by far the common case. sync-map.ts's fee mapping delegates
 * here so the two ingest paths can never disagree about a conversion.
 */
export function fxRateFor(
  currency: string,
  baseCurrency: string,
  fxRates?: Record<string, number> | null,
): number {
  if (!currency || currency.toUpperCase() === baseCurrency.toUpperCase()) return 1;
  const rate = fxRates?.[currency.toUpperCase()];
  return typeof rate === "number" && rate > 0 ? rate : 1;
}

/**
 * Linear-interpolated percentile over an ASCENDING array of cents.
 *
 * Interpolating rather than nearest-rank matters at the sample sizes this
 * actually runs on: with 4 sold comps, nearest-rank p25 and p75 collapse onto
 * real data points and the band reads narrower than the evidence supports.
 */
export function percentile(sortedCents: number[], p: number): number {
  if (sortedCents.length === 0) throw new Error("percentile of an empty array");
  if (sortedCents.length === 1) return sortedCents[0];

  const clamped = Math.min(1, Math.max(0, p));
  const pos = clamped * (sortedCents.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedCents[lo];
  return Math.round(sortedCents[lo] + (sortedCents[hi] - sortedCents[lo]) * (pos - lo));
}

/** Points observed within `windowDays` of `now`. */
export function inWindow<T extends { observedAt: Date }>(
  points: T[],
  now: Date,
  windowDays: number = DEFAULT_COMP_WINDOW_DAYS,
): T[] {
  const cutoff = now.getTime() - windowDays * MS_PER_DAY;
  return points.filter((p) => p.observedAt.getTime() >= cutoff);
}

/**
 * The band for one kind over one window. Null when nothing falls in the window
 * — an absent band and a band of zero are different facts, and the caller must
 * not render "0 €" for "we have never seen one".
 *
 * Throws on mixed kinds: see the file header. A silently-wrong band would
 * propagate into S32's bid ceiling.
 */
export function computeBand(
  points: PricePointInput[],
  opts: { kind: PriceKind; now: Date; windowDays?: number },
): PriceBand | null {
  const windowDays = opts.windowDays ?? DEFAULT_COMP_WINDOW_DAYS;

  const foreign = points.find((p) => p.kind !== opts.kind);
  if (foreign) {
    throw new Error(
      `computeBand received a ${foreign.kind} point while computing a ${opts.kind} band`,
    );
  }

  const inRange = inWindow(points, opts.now, windowDays);
  if (inRange.length === 0) return null;

  const sorted = inRange.map((p) => p.basePriceCents).sort((a, b) => a - b);

  return {
    kind: opts.kind,
    windowDays,
    sampleSize: sorted.length,
    p25Cents: percentile(sorted, 0.25),
    medianCents: percentile(sorted, 0.5),
    p75Cents: percentile(sorted, 0.75),
    minCents: sorted[0],
    maxCents: sorted[sorted.length - 1],
  };
}

/** How much weight the UI should let a band carry. */
export function confidenceFor(sampleSize: number): BandConfidence {
  if (sampleSize <= 0) return "NONE";
  if (sampleSize < MIN_BAND_SAMPLE) return "LOW";
  if (sampleSize < 10) return "MEDIUM";
  return "HIGH";
}

export interface DriftResult {
  /** Signed percent move of the median. Null with no previous to compare to. */
  pct: number | null;
  /** Threshold crossed AND sample big enough to believe it. */
  drifted: boolean;
  direction: "up" | "down" | "flat";
}

/**
 * Median move since the previous sweep.
 *
 * Gated on sample size as well as magnitude: a 40% swing computed over 2 points
 * is one unusual listing, not the market moving, and firing an alert on it
 * trains the operator to ignore alerts.
 */
export function driftFor(
  medianCents: number,
  prevMedianCents: number | null | undefined,
  opts: { sampleSize: number; thresholdPct?: number; minSample?: number },
): DriftResult {
  const threshold = opts.thresholdPct ?? DRIFT_THRESHOLD_PCT;
  const minSample = opts.minSample ?? MIN_BAND_SAMPLE;

  // No baseline, or a zero baseline that would divide to Infinity.
  if (prevMedianCents === null || prevMedianCents === undefined || prevMedianCents <= 0) {
    return { pct: null, drifted: false, direction: "flat" };
  }

  const pct = ((medianCents - prevMedianCents) / prevMedianCents) * 100;
  const rounded = Math.round(pct * 100) / 100;
  const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";

  return {
    pct: rounded,
    drifted: opts.sampleSize >= minSample && Math.abs(rounded) >= threshold,
    direction,
  };
}

/**
 * Where a unit's asking price sits against its band: below p25 is cheap,
 * above p75 is dear. Null when there is no band to compare against — the caller
 * renders "pas de comparable", never a neutral-looking "au prix du marché".
 */
export function positionInBand(
  priceCents: number,
  band: PriceBand | null,
): "below" | "within" | "above" | null {
  if (!band) return null;
  if (priceCents < band.p25Cents) return "below";
  if (priceCents > band.p75Cents) return "above";
  return "within";
}

// ————— dedupe keys —————
//
// Same contract as UnitCost.dedupeKey (src/lib/chronos/sync-map.ts): namespaced
// by source so two ingest paths can never collide, and deterministic so a
// re-run of an overlapping window upserts the same row instead of double-
// counting a comp — which would quietly weight one observation twice in the
// median.

/** A sale of his own. One per unit, ever, however many times the sweep runs. */
export function ownSaleDedupeKey(unitId: string): string {
  return `own:${unitId}`;
}

/**
 * An asking-price observation, keyed per listing PER DAY.
 *
 * Per day is the deliberate granularity: the same listing seen tomorrow at a
 * lower price is a real new data point (that is the price history), but the
 * same listing seen twice in one sweep is not.
 */
export function browseDedupeKey(provider: string, externalId: string, observedAt: Date): string {
  return `${provider}:${externalId}:${observedAt.toISOString().slice(0, 10)}`;
}

/** A hand-entered comp. Namespaced so it can never collide with an ingested one. */
export function manualDedupeKey(token: string): string {
  return `manual:${token}`;
}

/**
 * Whether a listing title plausibly refers to this reference.
 *
 * Deliberately conservative, and the same "never guess a match" discipline
 * S29's reconciliation queue applies to orders: an ask attributed to the wrong
 * reference silently poisons that reference's band. A listing matches only if
 * its title contains one of the ref's own declared aliases — no fuzzy scoring,
 * no brand-only fallback. Unmatched listings are dropped rather than queued:
 * unlike an order (which is money that already moved and must be accounted
 * for), a missed ask observation costs nothing but one data point.
 */
export function titleMatchesAliases(title: string, aliases: string[]): boolean {
  if (aliases.length === 0) return false;
  const haystack = title.toLowerCase();
  return aliases.some((a) => {
    const needle = a.trim().toLowerCase();
    return needle.length > 0 && haystack.includes(needle);
  });
}

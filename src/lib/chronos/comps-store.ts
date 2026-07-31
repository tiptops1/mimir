import type { PrismaClient } from "@prisma/client";
import { UNSOLD_WHERE } from "./inventory";
import {
  basePriceCentsOf,
  computeBand,
  driftFor,
  DEFAULT_COMP_WINDOW_DAYS,
  type PriceBand,
  type PriceKind,
  type PriceSource,
} from "./comps";

// The Prisma half of the comp DB (S30). Pure band/drift arithmetic lives in
// comps.ts; this file is the only place that reads or writes the two models.
//
// Same split as margin.ts / inventory.ts and, more to the point, the same
// single-write-path discipline as costs.ts: `recordPricePoint` is the ONLY
// permitted way a PricePoint is created. Nothing calls prisma.pricePoint.create
// directly, because the compound-unique upsert below is what makes a re-run of
// an overlapping sweep window converge instead of double-weighting a comp in
// the median.

export interface RecordPricePointInput {
  refId: string;
  kind: PriceKind;
  provider: string;
  priceCents: number;
  currency?: string;
  fxRate?: number;
  condition?: string;
  title?: string;
  url?: string | null;
  observedAt: Date;
  /** SOLD only. An ask has no sale date, and inventing one would be a lie. */
  soldAt?: Date | null;
  source: PriceSource;
  /** From comps.ts's key builders. Never "" — see PricePoint in the schema. */
  dedupeKey: string;
}

/**
 * Upsert one observation. Returns whether it was newly created, so a sweep can
 * report "42 seen, 3 new" rather than implying it ingested 42 fresh comps.
 */
export async function recordPricePoint(
  prisma: PrismaClient,
  input: RecordPricePointInput,
): Promise<{ created: boolean }> {
  if (!input.dedupeKey) {
    throw new Error("recordPricePoint requires a non-empty dedupeKey");
  }
  if (input.kind === "ASK" && input.soldAt) {
    // Guard rather than silently drop: an ask carrying a sale date means a
    // caller has confused the two kinds, and that bug must not reach the band.
    throw new Error("An ASK price point cannot carry a soldAt date");
  }

  const fxRate = input.fxRate ?? 1;
  const data = {
    kind: input.kind,
    provider: input.provider,
    priceCents: Math.round(input.priceCents),
    currency: input.currency ?? "EUR",
    fxRate,
    basePriceCents: basePriceCentsOf(input.priceCents, fxRate),
    condition: input.condition ?? "",
    title: input.title ?? "",
    url: input.url ?? null,
    observedAt: input.observedAt,
    soldAt: input.soldAt ?? null,
    source: input.source,
  };

  const existing = await prisma.pricePoint.findFirst({
    where: { refId: input.refId, dedupeKey: input.dedupeKey },
    select: { id: true },
  });

  if (existing) {
    await prisma.pricePoint.update({ where: { id: existing.id }, data });
    return { created: false };
  }

  await prisma.pricePoint.create({
    data: { ...data, refId: input.refId, dedupeKey: input.dedupeKey },
  });
  return { created: true };
}

export interface StoredPoint {
  kind: PriceKind;
  basePriceCents: number;
  observedAt: Date;
}

/** Every observation for a reference of one kind, newest first. */
export async function listPointsForRef(
  prisma: PrismaClient,
  refId: string,
  kind: PriceKind,
): Promise<StoredPoint[]> {
  const rows = await prisma.pricePoint.findMany({
    where: { refId, kind },
    select: { kind: true, basePriceCents: true, observedAt: true },
    orderBy: { observedAt: "desc" },
  });
  return rows.map((r) => ({
    kind: r.kind as PriceKind,
    basePriceCents: r.basePriceCents,
    observedAt: r.observedAt,
  }));
}

export interface RefStatResult {
  refId: string;
  kind: PriceKind;
  band: PriceBand | null;
  driftPct: number | null;
  drifted: boolean;
}

/**
 * Recompute one (ref × kind) band and persist it, carrying the median it
 * replaced forward as the drift baseline.
 *
 * Reads the previous row BEFORE overwriting — that read is the entire drift
 * mechanism, and it is why this is an upsert of a single row rather than an
 * append to a history table. The observations themselves are the history.
 */
export async function recomputeRefStat(
  prisma: PrismaClient,
  refId: string,
  kind: PriceKind,
  opts: { now: Date; windowDays?: number },
): Promise<RefStatResult> {
  const windowDays = opts.windowDays ?? DEFAULT_COMP_WINDOW_DAYS;
  const points = await listPointsForRef(prisma, refId, kind);
  const band = computeBand(points, { kind, now: opts.now, windowDays });

  const previous = await prisma.refPriceStat.findFirst({
    where: { refId, kind },
    select: { id: true, medianCents: true, computedAt: true },
  });

  // No band means no observations in window. Leave any existing row alone: a
  // stale band the operator can see the date of beats silently deleting the
  // only market read they have.
  if (!band) {
    return { refId, kind, band: null, driftPct: null, drifted: false };
  }

  const drift = driftFor(band.medianCents, previous?.medianCents ?? null, {
    sampleSize: band.sampleSize,
  });

  const data = {
    windowDays: band.windowDays,
    sampleSize: band.sampleSize,
    p25Cents: band.p25Cents,
    medianCents: band.medianCents,
    p75Cents: band.p75Cents,
    minCents: band.minCents,
    maxCents: band.maxCents,
    prevMedianCents: previous?.medianCents ?? null,
    prevComputedAt: previous?.computedAt ?? null,
    driftPct: drift.pct,
    drifted: drift.drifted,
    computedAt: opts.now,
  };

  if (previous) {
    await prisma.refPriceStat.update({ where: { id: previous.id }, data });
  } else {
    await prisma.refPriceStat.create({ data: { ...data, refId, kind } });
  }

  return { refId, kind, band, driftPct: drift.pct, drifted: drift.drifted };
}

// ————— read side (the /chronos/argus dashboard) —————

export interface RefBandView {
  sampleSize: number;
  p25Cents: number;
  medianCents: number;
  p75Cents: number;
  minCents: number;
  maxCents: number;
  driftPct: number | null;
  drifted: boolean;
  computedAt: Date;
}

export interface MarketRow {
  refId: string;
  brand: string;
  reference: string;
  model: string;
  aliasCount: number;
  /** Completed sales of his own. The authoritative band. */
  sold: RefBandView | null;
  /** Open-listing asking prices. NEVER to be presented as sold. */
  ask: RefBandView | null;
  /** Units of this ref currently in stock, for the "what does this tell me" column. */
  unitsInStock: number;
}

export interface MarketOverview {
  rows: MarketRow[];
  refCount: number;
  soldPointCount: number;
  askPointCount: number;
  driftCount: number;
  lastComputedAt: Date | null;
}

function toView(row: {
  sampleSize: number;
  p25Cents: number;
  medianCents: number;
  p75Cents: number;
  minCents: number;
  maxCents: number;
  driftPct: number | null;
  drifted: boolean;
  computedAt: Date;
}): RefBandView {
  return {
    sampleSize: row.sampleSize,
    p25Cents: row.p25Cents,
    medianCents: row.medianCents,
    p75Cents: row.p75Cents,
    minCents: row.minCents,
    maxCents: row.maxCents,
    driftPct: row.driftPct,
    drifted: row.drifted,
    computedAt: row.computedAt,
  };
}

/**
 * Everything the market dashboard renders, in four queries rather than one per
 * reference. Reads only the persisted bands — it never recomputes, so opening
 * the page is cheap and always shows exactly what the last sweep concluded
 * (with its date visible, so a stale band is legible as stale).
 */
export async function getMarketOverview(prisma: PrismaClient): Promise<MarketOverview> {
  const [refs, stats, pointCounts, unitCounts] = await Promise.all([
    prisma.productRef.findMany({
      select: { id: true, brand: true, reference: true, model: true, aliases: true },
      orderBy: [{ brand: "asc" }, { reference: "asc" }],
    }),
    prisma.refPriceStat.findMany(),
    prisma.pricePoint.groupBy({ by: ["kind"], _count: { _all: true } }),
    // UNSOLD_WHERE, not `{ soldAt: null }`: Mongo stores no soldAt field until
    // one is written, and the bare null form silently matches nothing.
    prisma.inventoryUnit.groupBy({
      by: ["refId"],
      where: UNSOLD_WHERE,
      _count: { _all: true },
    }),
  ]);

  const byRef = new Map<string, { SOLD?: RefBandView; ASK?: RefBandView }>();
  for (const s of stats) {
    const entry = byRef.get(s.refId) ?? {};
    if (s.kind === "SOLD") entry.SOLD = toView(s);
    if (s.kind === "ASK") entry.ASK = toView(s);
    byRef.set(s.refId, entry);
  }

  const stockByRef = new Map(unitCounts.map((u) => [u.refId, u._count._all]));

  const rows: MarketRow[] = refs.map((r) => {
    const bands = byRef.get(r.id) ?? {};
    return {
      refId: r.id,
      brand: r.brand,
      reference: r.reference,
      model: r.model,
      aliasCount: r.aliases.length,
      sold: bands.SOLD ?? null,
      ask: bands.ASK ?? null,
      unitsInStock: stockByRef.get(r.id) ?? 0,
    };
  });

  const countFor = (kind: string) =>
    pointCounts.find((p) => p.kind === kind)?._count._all ?? 0;

  const computedDates = stats.map((s) => s.computedAt.getTime());

  return {
    rows,
    refCount: refs.length,
    soldPointCount: countFor("SOLD"),
    askPointCount: countFor("ASK"),
    driftCount: stats.filter((s) => s.drifted).length,
    lastComputedAt: computedDates.length > 0 ? new Date(Math.max(...computedDates)) : null,
  };
}

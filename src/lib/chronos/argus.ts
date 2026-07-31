import type { PrismaClient } from "@prisma/client";
import { getConnector, isApiConnector } from "./connectors";
import type { ConnectorListing } from "./connectors/types";
import { parseMarketplaces } from "./config";
import {
  browseDedupeKey,
  fxRateFor,
  ownSaleDedupeKey,
  titleMatchesAliases,
  DEFAULT_COMP_WINDOW_DAYS,
  PRICE_KINDS,
} from "./comps";
import { recomputeRefStat, recordPricePoint } from "./comps-store";

/**
 * Argus (S30) — the market-intelligence sweep.
 *
 * Shape follows Forseti's and Thor's snapshot sweeps, not the Huginn/Bragi
 * draft pipelines: it is synchronous, has no LLM call and needs no Inngest,
 * because there is nothing to generate — only to observe and recompute.
 *
 * DETECTION ONLY. Argus never touches the Heimdallr ledger. A drift alert is an
 * observation about the market, not a side-effectful action taken on the
 * operator's behalf, so there is nothing for a human to approve. Kairos (S32)
 * is the module that turns these bands into a *buy offer*, and that does go
 * through the ledger — the line D5 draws is side effects, and re-reading a
 * price is not one.
 *
 * Two ingest paths, and the difference between them is the whole design:
 *
 *  1. OWN SALES → `SOLD` points. Authoritative. Every sold InventoryUnit is a
 *     price a real buyer actually paid, and its real fees are already booked.
 *  2. OPEN LISTINGS → `ASK` points, via the connector's `searchListings`
 *     (eBay Browse, an open API). These are hopes, not sales.
 *
 * There is no third path and there will not be one: eBay's Marketplace Insights
 * API (third-party sold comps) is Limited Release and denied to
 * non-major-partners, and the Finding API died in early 2025.
 */

export interface ArgusSweepOptions {
  tenantId: string;
  now?: Date;
  windowDays?: number;
  /** Force a provider instead of reading tenant config (scripts, tests). */
  provider?: string;
  /**
   * Test/fixture seam, mirroring ChronosSyncOptions.fetchOrders — lets the
   * sweep be exercised end to end without a live marketplace credential.
   */
  fetchListings?: (query: string) => Promise<ConnectorListing[]>;
}

export interface ArgusSweepResult {
  provider: string;
  refsScanned: number;
  /** Sold units seen / newly turned into SOLD points. */
  ownSalesSeen: number;
  ownSalesRecorded: number;
  /** Listings returned / attributed to a ref / newly stored. */
  asksSeen: number;
  asksMatched: number;
  asksRecorded: number;
  asksUnattributed: number;
  bandsComputed: number;
  driftAlerts: number;
  skipped?: string;
}

interface FxContext {
  baseCurrency: string;
  fxRates: Record<string, number> | null;
}

async function readFxContext(prisma: PrismaClient): Promise<FxContext> {
  const config = await prisma.chronosConfig.findUnique({
    where: { singleton: "default" },
    select: { baseCurrency: true, fxRates: true },
  });
  return {
    baseCurrency: config?.baseCurrency ?? "EUR",
    fxRates: (config?.fxRates as Record<string, number> | null) ?? null,
  };
}

/** One tenant's market sweep. Called per ACTIVE tenant from /api/cron/argus. */
export async function runArgusForTenant(
  prisma: PrismaClient,
  opts: ArgusSweepOptions,
): Promise<ArgusSweepResult> {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? DEFAULT_COMP_WINDOW_DAYS;

  const refs = await prisma.productRef.findMany({
    select: { id: true, brand: true, reference: true, aliases: true },
  });

  const result: ArgusSweepResult = {
    provider: "",
    refsScanned: refs.length,
    ownSalesSeen: 0,
    ownSalesRecorded: 0,
    asksSeen: 0,
    asksMatched: 0,
    asksRecorded: 0,
    asksUnattributed: 0,
    bandsComputed: 0,
    driftAlerts: 0,
  };

  if (refs.length === 0) return { ...result, skipped: "no product references" };

  const fx = await readFxContext(prisma);

  // ————— 1. His own completed sales → SOLD —————
  //
  // `{ not: null }` rather than the isSet form: here we want units that HAVE a
  // value, and on Mongo `$ne: null` correctly excludes both null and absent.
  // (The isSet:false trap is the opposite question — "never processed".)
  const soldUnits = await prisma.inventoryUnit.findMany({
    where: { soldAt: { not: null }, salePriceCents: { not: null } },
    select: {
      id: true,
      refId: true,
      soldAt: true,
      soldOn: true,
      salePriceCents: true,
      saleCurrency: true,
      saleFxRate: true,
      condition: true,
    },
  });
  result.ownSalesSeen = soldUnits.length;

  for (const unit of soldUnits) {
    if (!unit.soldAt || unit.salePriceCents === null) continue;
    const currency = unit.saleCurrency || fx.baseCurrency;
    const { created } = await recordPricePoint(prisma, {
      refId: unit.refId,
      kind: "SOLD",
      // A sale of his own always carries the marketplace it happened on; a
      // hand-entered sale may not, and "manual" is an honest provider value.
      provider: unit.soldOn || "manual",
      priceCents: unit.salePriceCents,
      currency,
      // Prefer the rate recorded ON the sale — it is the rate that actually
      // applied that day. Today's config rate is only a fallback.
      fxRate: unit.saleFxRate ?? fxRateFor(currency, fx.baseCurrency, fx.fxRates),
      condition: unit.condition,
      // The band window is "sales in the last N days", so a sold point is
      // observed AS OF its sale date, not as of the sweep.
      observedAt: unit.soldAt,
      soldAt: unit.soldAt,
      source: "OWN_SALE",
      dedupeKey: ownSaleDedupeKey(unit.id),
    });
    if (created) result.ownSalesRecorded += 1;
  }

  // ————— 2. Open listings → ASK —————
  const marketplaces = parseMarketplaces(
    (
      await prisma.chronosConfig.findUnique({
        where: { singleton: "default" },
        select: { marketplaces: true },
      })
    )?.marketplaces,
  );

  const provider =
    opts.provider ??
    marketplaces.find(
      (m) =>
        m.sync === "api" && isApiConnector(m.key) && getConnector(m.key).capabilities.searchListings,
    )?.key ??
    "";
  result.provider = provider;

  const fetchListings =
    opts.fetchListings ??
    (provider && isApiConnector(provider) && getConnector(provider).searchListings
      ? (query: string) => getConnector(provider).searchListings!({ tenantId: opts.tenantId }, query)
      : null);

  if (fetchListings) {
    for (const ref of refs) {
      // A ref with no aliases has nothing to match a listing title against, and
      // matching on brand alone would poison its band with other models. Skip
      // rather than guess — the same discipline S29 applies to orders.
      if (ref.aliases.length === 0) continue;

      let listings: ConnectorListing[];
      try {
        listings = await fetchListings(`${ref.brand} ${ref.reference}`.trim());
      } catch {
        // One reference's search failing must not abort the sweep; the SOLD
        // half above has already been persisted and is the valuable half.
        continue;
      }

      result.asksSeen += listings.length;

      for (const listing of listings) {
        if (!titleMatchesAliases(listing.title, ref.aliases)) {
          result.asksUnattributed += 1;
          continue;
        }
        result.asksMatched += 1;
        const currency = listing.currency || fx.baseCurrency;
        const { created } = await recordPricePoint(prisma, {
          refId: ref.id,
          kind: "ASK",
          provider: provider || "unknown",
          priceCents: listing.priceCents,
          currency,
          fxRate: fxRateFor(currency, fx.baseCurrency, fx.fxRates),
          condition: listing.condition ?? "",
          title: listing.title,
          url: listing.url ?? null,
          observedAt: listing.observedAt,
          // Never a soldAt: an ask has not sold. recordPricePoint rejects one.
          source: "BROWSE",
          dedupeKey: browseDedupeKey(
            provider || "unknown",
            listing.externalId,
            listing.observedAt,
          ),
        });
        if (created) result.asksRecorded += 1;
      }
    }
  }

  // ————— 3. Recompute every band —————
  for (const ref of refs) {
    for (const kind of PRICE_KINDS) {
      const stat = await recomputeRefStat(prisma, ref.id, kind, { now, windowDays });
      if (stat.band) result.bandsComputed += 1;
      if (stat.drifted) result.driftAlerts += 1;
    }
  }

  return result;
}

import { fnv1a, mulberry32 } from "@/lib/freyja/connectors/demo";
import type { ConnectorCtx, ConnectorListing, MarketplaceConnector } from "./types";

// Deterministic offline marketplace provider (S27). The only implementation
// until real eBay access exists (S29 needs a production keyset on a business
// account, plus a RuName redirect — see the Chronos plan's risk #4).
//
// Everything is a pure function of its inputs via the seeded PRNG, reusing
// Freyja's fnv1a/mulberry32 rather than re-deriving them, so re-syncs converge
// on identical rows (idempotent) and tests can assert exact values.
//
// Seeded data, not code vocabulary: the constants below describe this demo
// provider's simulation, not any tenant's business.

const DEMO_TITLES = [
  "Seiko SKX007 automatique — révisée",
  "Omega Seamaster 300M — boîte et papiers",
  "Tissot PRX 40 quartz — état neuf",
  "Certina DS Action Diver — bracelet acier",
  "Longines Conquest — révision récente",
];

const DEMO_CONDITIONS = ["Très bon état", "Bon état", "Excellent état", "À réviser"];

/** Days since the Unix epoch, so a listing's price drifts slowly over time. */
function epochDays(at: Date): number {
  return Math.floor(at.getTime() / 86_400_000);
}

/**
 * One deterministic asking-price observation for (query, index, day). Pure.
 * Invariants the tests assert: priceCents > 0, currency is the provider's, and
 * the same (query, day) always yields the same list.
 */
function generateListing(query: string, index: number, at: Date): ConnectorListing {
  const rand = mulberry32(fnv1a(`${query}|${index}|${epochDays(at)}`));
  const base = 40_000 + Math.floor(rand() * 260_000); // 400 € – 3 000 €
  return {
    externalId: `demo-listing-${fnv1a(`${query}|${index}`).toString(36)}`,
    title: DEMO_TITLES[index % DEMO_TITLES.length],
    priceCents: base,
    currency: "EUR",
    condition: DEMO_CONDITIONS[Math.floor(rand() * DEMO_CONDITIONS.length)],
    observedAt: at,
  };
}

export function generateListings(query: string, at: Date, count = 5): ConnectorListing[] {
  return Array.from({ length: count }, (_, i) => generateListing(query, i, at));
}

/**
 * The demo provider.
 *
 * `soldComps: false` is not a placeholder — it mirrors the real world, where
 * eBay's Marketplace Insights API is gated. `ownListings`/`ownOrders` are false
 * too: the demo tenant's units and their cost lines are seeded rows
 * (scripts/chronos/seed-demo-units.ts), not fetched, so inventing synthetic
 * orders here would give the S29 reconciliation path a fake happy case to pass
 * against. Only the open, genuinely available capability is implemented.
 */
export const demoConnector: MarketplaceConnector = {
  provider: "demo",
  capabilities: {
    searchListings: true,
    soldComps: false,
    ownListings: false,
    ownOrders: false,
  },
  async searchListings(_ctx: ConnectorCtx, query: string): Promise<ConnectorListing[]> {
    return generateListings(query, new Date());
  },
};

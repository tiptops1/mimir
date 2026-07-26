import { describe, expect, it } from "vitest";
import { capabilityDrift, getConnector, listConnectors } from "./index";
import { generateListings } from "./demo";
import type { MarketplaceConnector } from "./types";

describe("connector registry", () => {
  it("resolves the demo provider and throws on an unknown one", () => {
    expect(getConnector("demo").provider).toBe("demo");
    expect(() => getConnector("nope")).toThrow(/Unknown marketplace connector/);
  });

  it("no registered connector's capabilities drift from its methods", () => {
    for (const connector of listConnectors()) {
      expect(capabilityDrift(connector)).toEqual([]);
    }
  });

  it("catches a capability declared without its method", () => {
    const liar: MarketplaceConnector = {
      provider: "liar",
      capabilities: { searchListings: false, soldComps: true, ownListings: false, ownOrders: false },
    };
    expect(capabilityDrift(liar)).toEqual([
      "liar: declares soldComps but has no fetchSoldComps()",
    ]);
  });

  it("catches a method implemented without its capability declared", () => {
    const shy: MarketplaceConnector = {
      provider: "shy",
      capabilities: { searchListings: false, soldComps: false, ownListings: false, ownOrders: false },
      async searchListings() {
        return [];
      },
    };
    expect(capabilityDrift(shy)).toEqual([
      "shy: implements searchListings() but declares searchListings false",
    ]);
  });

  it("declares soldComps false everywhere — Marketplace Insights is gated", () => {
    for (const connector of listConnectors()) {
      expect(connector.capabilities.soldComps).toBe(false);
    }
  });
});

describe("demo provider", () => {
  const at = new Date("2026-07-26T00:00:00Z");

  it("is deterministic — same (query, day) gives an identical list", () => {
    expect(generateListings("seiko skx007", at)).toEqual(generateListings("seiko skx007", at));
  });

  it("varies by query", () => {
    const a = generateListings("seiko skx007", at);
    const b = generateListings("omega seamaster", at);
    expect(a.map((l) => l.priceCents)).not.toEqual(b.map((l) => l.priceCents));
  });

  it("returns positive prices in the provider's currency", () => {
    for (const listing of generateListings("tissot prx", at)) {
      expect(listing.priceCents).toBeGreaterThan(0);
      expect(Number.isInteger(listing.priceCents)).toBe(true);
      expect(listing.currency).toBe("EUR");
      expect(listing.observedAt).toEqual(at);
    }
  });
});

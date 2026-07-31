import { describe, expect, it } from "vitest";
import {
  applyModelBid,
  bidCeiling,
  detectFlags,
  hasVeto,
  parseKairosOutput,
  scoreListing,
} from "./kairos";
import type { PriceBand } from "./comps";

function band(medianCents: number, kind: "SOLD" | "ASK" = "SOLD"): PriceBand {
  return {
    kind,
    windowDays: 180,
    sampleSize: 8,
    p25Cents: Math.round(medianCents * 0.9),
    medianCents,
    p75Cents: Math.round(medianCents * 1.1),
    minCents: Math.round(medianCents * 0.8),
    maxCents: Math.round(medianCents * 1.2),
  };
}

describe("detectFlags", () => {
  it("catches English disqualifiers", () => {
    expect(detectFlags("Seiko SKX007 — for parts").map((f) => f.key)).toContain("for_parts");
    expect(detectFlags("Omega, not running").map((f) => f.key)).toContain("not_running");
    expect(detectFlags("Rolex replica").map((f) => f.key)).toContain("replica");
  });

  it("catches French disqualifiers", () => {
    expect(detectFlags("Montre vendue pour pièces").map((f) => f.key)).toContain("for_parts");
    expect(detectFlags("Mouvement en panne").map((f) => f.key)).toContain("not_running");
  });

  it("catches franken and redial signals", () => {
    expect(detectFlags("Frankenwatch build").map((f) => f.key)).toContain("franken");
    expect(detectFlags("Nice redialled piece").map((f) => f.key)).toContain("redial");
  });

  it("is case-insensitive and searches the description too", () => {
    const flags = detectFlags("Belle montre", "SPARES OR REPAIRS only");
    expect(flags.map((f) => f.key)).toContain("for_parts");
  });

  it("separates caution flags from vetoes", () => {
    const flags = detectFlags("Seiko SKX007 — untested, no returns");
    expect(hasVeto(flags)).toBe(false);
    expect(flags.map((f) => f.key).sort()).toEqual(["no_return", "untested"]);
  });

  it("returns nothing for a clean listing", () => {
    expect(detectFlags("Seiko SKX007 automatique, révisée, boîte et papiers")).toEqual([]);
  });
});

describe("bidCeiling", () => {
  it("subtracts fees, refurb and the target margin", () => {
    const c = bidCeiling({
      band: band(100_000), // 1 000 € resale
      targetMarginPct: 25,
      resaleFees: { finalValuePct: 10 },
      refurbCostCents: 5_000,
    })!;
    expect(c.expectedResaleCents).toBe(100_000);
    expect(c.estimatedFeesCents).toBe(10_000);
    expect(c.refurbCostCents).toBe(5_000);
    expect(c.requiredMarginCents).toBe(25_000);
    expect(c.maxBidCents).toBe(60_000); // 100k − 10k − 5k − 25k
  });

  it("REFUSES an ASK band — a purchase is never priced off asking prices", () => {
    expect(
      bidCeiling({ band: band(100_000, "ASK"), targetMarginPct: 25 }),
    ).toBeNull();
  });

  it("never returns a negative ceiling", () => {
    const c = bidCeiling({
      band: band(10_000),
      targetMarginPct: 50,
      resaleFees: { finalValuePct: 20 },
      refurbCostCents: 20_000,
    })!;
    expect(c.maxBidCents).toBe(0);
  });

  it("returns null on a zero median", () => {
    expect(bidCeiling({ band: band(0), targetMarginPct: 25 })).toBeNull();
  });
});

describe("scoreListing", () => {
  const base = {
    soldBand: band(100_000),
    targetMarginPct: 25,
    resaleFees: { finalValuePct: 10 },
  };

  it("scores a clean, cheap listing as a candidate", () => {
    const r = scoreListing({ ...base, askPriceCents: 30_000, title: "Seiko SKX007 révisée" });
    expect(r.verdict).toBe("candidate");
    expect(r.headroomCents).toBe(35_000); // ceiling 65 000 − ask 30 000
    expect(r.score).toBeGreaterThan(50);
  });

  it("vetoes BEFORE looking at price — a cheap parts watch is still vetoed", () => {
    const r = scoreListing({
      ...base,
      askPriceCents: 1_000,
      title: "Seiko SKX007 for parts",
    });
    expect(r.verdict).toBe("vetoed");
    expect(r.score).toBe(0);
    expect(r.ceiling).toBeNull();
  });

  it("vetoes even with no comp available — the reason must be the real one", () => {
    const r = scoreListing({
      ...base,
      soldBand: null,
      askPriceCents: 1_000,
      title: "Not running, spares or repairs",
    });
    expect(r.verdict).toBe("vetoed");
  });

  it("reports no_comp when there is no sold band", () => {
    const r = scoreListing({ ...base, soldBand: null, askPriceCents: 30_000, title: "Seiko SKX007" });
    expect(r.verdict).toBe("no_comp");
    expect(r.reason).toMatch(/comparable/i);
  });

  it("rejects an overpriced listing with negative headroom", () => {
    const r = scoreListing({ ...base, askPriceCents: 90_000, title: "Seiko SKX007" });
    expect(r.verdict).toBe("too_expensive");
    expect(r.headroomCents).toBeLessThan(0);
    expect(r.score).toBe(0);
  });

  it("applies the watchlist cap when it is STRICTER than the margin ceiling", () => {
    // Margin ceiling is 65 000; a 40% cap on a 100 000 median is 40 000.
    const r = scoreListing({ ...base, askPriceCents: 45_000, title: "Seiko SKX007", maxPricePct: 40 });
    expect(r.ceiling!.maxBidCents).toBe(40_000);
    expect(r.verdict).toBe("too_expensive");
  });

  it("does NOT let a loose watchlist cap raise the margin ceiling", () => {
    const r = scoreListing({ ...base, askPriceCents: 30_000, title: "Seiko SKX007", maxPricePct: 95 });
    expect(r.ceiling!.maxBidCents).toBe(65_000);
  });

  it("keeps caution flags visible on an otherwise good candidate", () => {
    const r = scoreListing({
      ...base,
      askPriceCents: 30_000,
      title: "Seiko SKX007, untested",
    });
    expect(r.verdict).toBe("candidate");
    expect(r.flags.map((f) => f.key)).toContain("untested");
  });

  it("treats an exactly-at-ceiling ask as a candidate with zero headroom", () => {
    const r = scoreListing({ ...base, askPriceCents: 65_000, title: "Seiko SKX007" });
    expect(r.verdict).toBe("candidate");
    expect(r.headroomCents).toBe(0);
    expect(r.score).toBe(0);
  });
});

describe("applyModelBid", () => {
  it("accepts a bid at or below the ceiling", () => {
    expect(applyModelBid(40_000, 65_000)).toEqual({ bidCents: 40_000, clamped: false });
    expect(applyModelBid(65_000, 65_000)).toEqual({ bidCents: 65_000, clamped: false });
  });

  it("CLAMPS a model that tries to bid above the ceiling, and says so", () => {
    expect(applyModelBid(90_000, 65_000)).toEqual({ bidCents: 65_000, clamped: true });
  });

  it("never returns a negative bid", () => {
    expect(applyModelBid(-500, 65_000).bidCents).toBe(0);
  });
});

describe("parseKairosOutput", () => {
  it("parses a well-formed payload", () => {
    const r = parseKairosOutput('{"recommendedBidCents":40000,"rationale":"ok","concerns":[]}');
    expect(r?.recommendedBidCents).toBe(40_000);
  });

  it("strips a code fence", () => {
    const r = parseKairosOutput('```json\n{"recommendedBidCents":1,"rationale":"x"}\n```');
    expect(r?.recommendedBidCents).toBe(1);
  });

  it("fails CLOSED on malformed, empty or wrong-shaped output", () => {
    expect(parseKairosOutput(null)).toBeNull();
    expect(parseKairosOutput("not json")).toBeNull();
    expect(parseKairosOutput('{"recommendedBidCents":"lots","rationale":"x"}')).toBeNull();
    expect(parseKairosOutput('{"rationale":"missing the bid"}')).toBeNull();
  });

  it("rejects a negative recommended bid rather than coercing it", () => {
    expect(parseKairosOutput('{"recommendedBidCents":-5,"rationale":"x"}')).toBeNull();
  });
});

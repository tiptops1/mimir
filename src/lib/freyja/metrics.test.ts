import { describe, expect, it } from "vitest";
import { aggregateInsights, dayKey, deriveRates, lastNDays } from "./metrics";

const zero = { spendEur: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };

describe("dayKey / lastNDays", () => {
  it("formats UTC day keys", () => {
    expect(dayKey(new Date("2026-07-19T23:59:59Z"))).toBe("2026-07-19");
  });

  it("returns n keys ending yesterday, oldest first", () => {
    const days = lastNDays(3, new Date("2026-07-19T12:00:00Z"));
    expect(days).toEqual(["2026-07-16", "2026-07-17", "2026-07-18"]);
  });
});

describe("deriveRates", () => {
  it("maps zero denominators to null, not NaN/Infinity", () => {
    expect(deriveRates(zero)).toEqual({ cpc: null, cpa: null, roas: null, ctr: null });
  });

  it("computes the rates", () => {
    const rates = deriveRates({ spendEur: 100, impressions: 10_000, clicks: 200, conversions: 10, conversionValue: 300 });
    expect(rates.cpc).toBeCloseTo(0.5);
    expect(rates.cpa).toBeCloseTo(10);
    expect(rates.roas).toBeCloseTo(3);
    expect(rates.ctr).toBeCloseTo(0.02);
  });
});

describe("aggregateInsights", () => {
  it("sums totals and splits last7/prior7 windows by day order", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      day: `2026-07-${String(i + 1).padStart(2, "0")}`,
      spendEur: 10,
      impressions: 1000,
      clicks: i < 7 ? 40 : 20, // older week clicks higher
      conversions: 1,
      conversionValue: 25,
    }));
    const agg = aggregateInsights(rows);
    expect(agg.days).toBe(14);
    expect(agg.totals.spendEur).toBe(140);
    expect(agg.prior7.clicks).toBe(280);
    expect(agg.last7.clicks).toBe(140);
  });

  it("handles an empty window", () => {
    const agg = aggregateInsights([]);
    expect(agg.days).toBe(0);
    expect(agg.rates.roas).toBeNull();
  });
});

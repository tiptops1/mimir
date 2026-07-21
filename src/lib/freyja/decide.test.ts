import { describe, expect, it } from "vitest";
import { aggregateInsights, type InsightRow } from "./metrics";
import { checkBudgetDelta, flagCampaign, parseDecisionOutput } from "./decide";

const config = { roasFloor: 1.5, minSpend14dEur: 50 };

function rows(overrides: Partial<InsightRow>, days = 14): InsightRow[] {
  return Array.from({ length: days }, (_, i) => ({
    day: `2026-07-${String(i + 1).padStart(2, "0")}`,
    spendEur: 10,
    impressions: 1000,
    clicks: 25,
    conversions: 2,
    conversionValue: 40,
    ...overrides,
  }));
}

describe("flagCampaign", () => {
  it("suppresses everything below the 14d minimum spend", () => {
    const agg = aggregateInsights(rows({ spendEur: 3, conversions: 0, conversionValue: 0 }));
    expect(flagCampaign(agg, config, { dailyBudget: 10 })).toEqual([]);
  });

  it("flags spend with zero conversions", () => {
    const agg = aggregateInsights(rows({ conversions: 0, conversionValue: 0 }));
    const flags = flagCampaign(agg, config, { dailyBudget: 50 });
    expect(flags.map((f) => f.key)).toContain("spend_no_conversions");
  });

  it("flags ROAS below the floor (with conversions present)", () => {
    // spend 140, value 70 -> ROAS 0.5
    const agg = aggregateInsights(rows({ conversionValue: 5 }));
    const flags = flagCampaign(agg, config, { dailyBudget: 50 });
    expect(flags.map((f) => f.key)).toContain("roas_below_floor");
    expect(flags.map((f) => f.key)).not.toContain("spend_no_conversions");
  });

  it("flags CTR decay when trailing 7d falls under 60% of the prior 7d", () => {
    const decayed = [
      ...rows({ clicks: 50 }, 7),
      ...rows({ clicks: 10 }, 7).map((r, i) => ({
        ...r,
        day: `2026-07-${String(i + 8).padStart(2, "0")}`,
      })),
    ];
    const agg = aggregateInsights(decayed);
    const flags = flagCampaign(agg, config, { dailyBudget: 50 });
    expect(flags.map((f) => f.key)).toContain("ctr_decay");
  });

  it("flags a scaling opportunity: high ROAS and budget at saturation", () => {
    // spend 140 over 14d vs dailyBudget 10 => saturation; ROAS 40/10 = 4
    const agg = aggregateInsights(rows({ conversionValue: 40 }));
    const flags = flagCampaign(agg, config, { dailyBudget: 10 });
    expect(flags.map((f) => f.key)).toContain("scaling_opportunity");
  });

  it("a healthy mid-range campaign gets no flags", () => {
    // ROAS 2.0 (spend 10, value 20), no decay, no saturation vs budget 20
    const agg = aggregateInsights(rows({ conversionValue: 20 }));
    expect(flagCampaign(agg, config, { dailyBudget: 20 })).toEqual([]);
  });
});

describe("checkBudgetDelta", () => {
  it("accepts a change exactly at the cap", () => {
    expect(checkBudgetDelta(100, 120, 20)).toEqual({ ok: true, deltaPct: 20 });
  });

  it("rejects a change over the cap, either direction", () => {
    expect(checkBudgetDelta(100, 121, 20).ok).toBe(false);
    expect(checkBudgetDelta(100, 79, 20).ok).toBe(false);
  });

  it("accepts a decrease within the cap", () => {
    expect(checkBudgetDelta(100, 85, 20).ok).toBe(true);
  });

  it("fails closed on a zero/negative current budget", () => {
    expect(checkBudgetDelta(0, 50, 20).ok).toBe(false);
  });
});

describe("parseDecisionOutput", () => {
  it("fails closed on null, garbage, and truncated JSON", () => {
    expect(parseDecisionOutput(null)).toBeNull();
    expect(parseDecisionOutput("not json")).toBeNull();
    expect(parseDecisionOutput('{"kind":"budget_change","newDailyBudget":')).toBeNull();
  });

  it("rejects a known kind with missing params or rationale", () => {
    expect(parseDecisionOutput('{"kind":"budget_change","rationale":"x"}')).toBeNull();
    expect(parseDecisionOutput('{"kind":"campaign_pause"}')).toBeNull();
    expect(parseDecisionOutput('{"kind":"bid_adjust","bidAdjustPct":80,"rationale":"x"}')).toBeNull();
  });

  it("rejects an unknown kind", () => {
    expect(parseDecisionOutput('{"kind":"delete_campaign","rationale":"x"}')).toBeNull();
  });

  it("accepts each valid kind, with or without a json fence", () => {
    expect(parseDecisionOutput('{"kind":"none","rationale":"trop peu de données"}')).toEqual({
      kind: "none",
      rationale: "trop peu de données",
    });
    expect(
      parseDecisionOutput('```json\n{"kind":"budget_change","newDailyBudget":90,"rationale":"ROAS 4.1"}\n```'),
    ).toEqual({ kind: "budget_change", newDailyBudget: 90, rationale: "ROAS 4.1" });
    expect(parseDecisionOutput('{"kind":"campaign_pause","rationale":"aucune conversion"}')).toEqual({
      kind: "campaign_pause",
      rationale: "aucune conversion",
    });
    expect(
      parseDecisionOutput('{"kind":"bid_adjust","bidAdjustPct":-15,"rationale":"CPA élevé"}'),
    ).toEqual({ kind: "bid_adjust", bidAdjustPct: -15, rationale: "CPA élevé" });
  });
});

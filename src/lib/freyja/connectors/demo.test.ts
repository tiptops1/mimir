import { describe, expect, it } from "vitest";
import { fnv1a, generateDailyMetric, mulberry32 } from "./demo";
import { aggregateInsights, lastNDays } from "../metrics";

const winner = { externalId: "demo-win", dailyBudget: 80, config: { archetype: "winner" } };
const loser = { externalId: "demo-lose", dailyBudget: 45, config: { archetype: "loser" } };
const fatiguing = { externalId: "demo-fatigue", dailyBudget: 50, config: { archetype: "fatiguing" } };

function seriesFor(campaign: typeof winner, days: string[]) {
  return days.map((day) => {
    const m = generateDailyMetric(campaign, day);
    return { day: m.day, spendEur: m.spendEur, impressions: m.impressions, clicks: m.clicks, conversions: m.conversions, conversionValue: m.conversionValue };
  });
}

describe("mulberry32/fnv1a", () => {
  it("same seed produces the same sequence", () => {
    const a = mulberry32(fnv1a("x"));
    const b = mulberry32(fnv1a("x"));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("generateDailyMetric", () => {
  it("is deterministic — same (campaign, day) twice gives an identical row", () => {
    expect(generateDailyMetric(winner, "2026-07-10")).toEqual(
      generateDailyMetric(winner, "2026-07-10"),
    );
  });

  it("different days give different rows", () => {
    expect(generateDailyMetric(winner, "2026-07-10")).not.toEqual(
      generateDailyMetric(winner, "2026-07-11"),
    );
  });

  it("holds the counter invariants on every archetype", () => {
    for (const campaign of [winner, loser, fatiguing]) {
      for (const day of lastNDays(14, new Date("2026-07-19T12:00:00Z"))) {
        const m = generateDailyMetric(campaign, day);
        expect(m.spendEur).toBeGreaterThanOrEqual(0);
        expect(m.spendEur).toBeLessThanOrEqual(campaign.dailyBudget);
        expect(m.clicks).toBeLessThanOrEqual(m.impressions);
        expect(m.conversions).toBeLessThanOrEqual(m.clicks);
        expect(m.conversionValue).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("winner outperforms loser on 14-day ROAS", () => {
    const days = lastNDays(14, new Date("2026-07-19T12:00:00Z"));
    const winAgg = aggregateInsights(seriesFor(winner, days));
    const loseAgg = aggregateInsights(seriesFor(loser, days));
    expect(winAgg.rates.roas).not.toBeNull();
    expect(loseAgg.rates.roas).not.toBeNull();
    expect(winAgg.rates.roas!).toBeGreaterThan(2);
    expect(loseAgg.rates.roas!).toBeLessThan(1);
  });

  it("fatiguing campaign shows a mid-cycle CTR downtrend (trailing 7 < prior 7)", () => {
    // Pick a window fully inside one 28-day decay cycle so the trend is clean.
    const cycleStart = new Date("2026-07-02T12:00:00Z"); // epochDays % 28 alignment not required — just avoid the wrap
    const days = lastNDays(14, new Date(cycleStart.getTime() + 15 * 86_400_000));
    const agg = aggregateInsights(seriesFor(fatiguing, days));
    expect(agg.last7.rates.ctr).not.toBeNull();
    expect(agg.prior7.rates.ctr).not.toBeNull();
    expect(agg.last7.rates.ctr!).toBeLessThan(agg.prior7.rates.ctr!);
  });
});

import { describe, expect, it } from "vitest";
import { decisionPayloadSchema } from "./executor";

const base = {
  campaignId: "665f1f77bcf86cd799439011",
  campaignName: "Search — Assurance emprunteur",
  rationale: "ROAS 0.4 sur 14 jours",
};

describe("decisionPayloadSchema", () => {
  it("accepts each kind with its params", () => {
    expect(
      decisionPayloadSchema.safeParse({ ...base, kind: "budget_change", newDailyBudget: 90 }).success,
    ).toBe(true);
    expect(decisionPayloadSchema.safeParse({ ...base, kind: "campaign_pause" }).success).toBe(true);
    expect(
      decisionPayloadSchema.safeParse({ ...base, kind: "bid_adjust", bidAdjustPct: -20 }).success,
    ).toBe(true);
  });

  it("rejects unknown kinds and out-of-range bid adjustments", () => {
    expect(decisionPayloadSchema.safeParse({ ...base, kind: "none" }).success).toBe(false);
    expect(
      decisionPayloadSchema.safeParse({ ...base, kind: "bid_adjust", bidAdjustPct: 200 }).success,
    ).toBe(false);
  });

  it("accepts the optional evidence block", () => {
    const parsed = decisionPayloadSchema.safeParse({
      ...base,
      kind: "campaign_pause",
      evidence: {
        flags: [{ key: "spend_no_conversions", label: "Dépense sans conversion", detail: "140 €" }],
        spend14dEur: 140,
        roas14d: null,
        conversions14d: 0,
        currentDailyBudget: 45,
      },
    });
    expect(parsed.success).toBe(true);
  });
});

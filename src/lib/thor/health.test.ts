import { describe, expect, it } from "vitest";
import {
  evaluateCompanyHealth,
  summarizeHealth,
  type CompanyHealthInput,
} from "./health";

const NOW = new Date(2026, 6, 19); // 2026-07-19, matches CLAUDE.md "today"

function baseInput(overrides: Partial<CompanyHealthInput> = {}): CompanyHealthInput {
  return {
    id: "c1",
    name: "Acme Courtage",
    dernierContact: NOW,
    latestActivitySentiment: "POSITIF",
    latestActivityDate: NOW,
    wonDeals: [],
    primaryOpenDeal: null,
    ...overrides,
  };
}

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

describe("evaluateCompanyHealth — healthy baseline", () => {
  it("scores 100 / healthy with no signals", () => {
    const result = evaluateCompanyHealth(baseInput(), NOW);
    expect(result.score).toBe(100);
    expect(result.band).toBe("healthy");
    expect(result.signals).toHaveLength(0);
  });
});

describe("evaluateCompanyHealth — stale_contact", () => {
  it("flags when both dernierContact and latest activity are stale", () => {
    const result = evaluateCompanyHealth(
      baseInput({ dernierContact: daysAgo(60), latestActivityDate: daysAgo(60) }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).toContain("stale_contact");
    expect(result.score).toBe(75);
    expect(result.band).toBe("at_risk");
  });

  it("uses the more recent of dernierContact / latest activity", () => {
    const result = evaluateCompanyHealth(
      baseInput({ dernierContact: daysAgo(60), latestActivityDate: daysAgo(5) }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).not.toContain("stale_contact");
  });

  it("flags when neither is set", () => {
    const result = evaluateCompanyHealth(
      baseInput({ dernierContact: null, latestActivityDate: null }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).toContain("stale_contact");
  });
});

describe("evaluateCompanyHealth — negative_sentiment", () => {
  it("flags NEGATIF sentiment", () => {
    const result = evaluateCompanyHealth(
      baseInput({ latestActivitySentiment: "NEGATIF" }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).toContain("negative_sentiment");
  });

  it("does not flag NEUTRE or null", () => {
    expect(
      evaluateCompanyHealth(baseInput({ latestActivitySentiment: "NEUTRE" }), NOW)
        .signals.map((s) => s.key),
    ).not.toContain("negative_sentiment");
    expect(
      evaluateCompanyHealth(baseInput({ latestActivitySentiment: null }), NOW)
        .signals.map((s) => s.key),
    ).not.toContain("negative_sentiment");
  });
});

describe("evaluateCompanyHealth — renewal_approaching", () => {
  it("flags a WON deal closed 305-395 days ago", () => {
    const result = evaluateCompanyHealth(
      baseInput({ wonDeals: [{ closeDate: daysAgo(350) }] }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).toContain("renewal_approaching");
  });

  it("does not flag a deal closed 200 days ago", () => {
    const result = evaluateCompanyHealth(
      baseInput({ wonDeals: [{ closeDate: daysAgo(200) }] }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).not.toContain("renewal_approaching");
  });

  it("does not flag a deal with no closeDate", () => {
    const result = evaluateCompanyHealth(
      baseInput({ wonDeals: [{ closeDate: null }] }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).not.toContain("renewal_approaching");
  });
});

describe("evaluateCompanyHealth — stalled_deal", () => {
  it("flags a primary open deal untouched for 60+ days", () => {
    const result = evaluateCompanyHealth(
      baseInput({ primaryOpenDeal: { updatedAt: daysAgo(90) } }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).toContain("stalled_deal");
  });

  it("does not flag a recently updated open deal", () => {
    const result = evaluateCompanyHealth(
      baseInput({ primaryOpenDeal: { updatedAt: daysAgo(5) } }),
      NOW,
    );
    expect(result.signals.map((s) => s.key)).not.toContain("stalled_deal");
  });

  it("does not flag when there is no open deal", () => {
    const result = evaluateCompanyHealth(baseInput({ primaryOpenDeal: null }), NOW);
    expect(result.signals.map((s) => s.key)).not.toContain("stalled_deal");
  });
});

describe("evaluateCompanyHealth — band thresholds", () => {
  it("critical when score drops below 50 (multiple signals)", () => {
    const result = evaluateCompanyHealth(
      baseInput({
        dernierContact: daysAgo(90),
        latestActivityDate: daysAgo(90),
        latestActivitySentiment: "NEGATIF",
        primaryOpenDeal: { updatedAt: daysAgo(90) },
      }),
      NOW,
    );
    expect(result.score).toBe(20);
    expect(result.band).toBe("critical");
  });

  it("score never drops below 0", () => {
    const result = evaluateCompanyHealth(
      baseInput({
        dernierContact: daysAgo(90),
        latestActivityDate: daysAgo(90),
        latestActivitySentiment: "NEGATIF",
        wonDeals: [{ closeDate: daysAgo(350) }],
        primaryOpenDeal: { updatedAt: daysAgo(90) },
      }),
      NOW,
    );
    expect(result.score).toBe(0);
    expect(result.band).toBe("critical");
  });
});

describe("summarizeHealth", () => {
  it("aggregates band counts", () => {
    const results = [
      evaluateCompanyHealth(baseInput({ id: "a" }), NOW),
      evaluateCompanyHealth(
        baseInput({ id: "b", dernierContact: daysAgo(60), latestActivityDate: daysAgo(60) }),
        NOW,
      ),
      evaluateCompanyHealth(
        baseInput({
          id: "c",
          dernierContact: daysAgo(90),
          latestActivityDate: daysAgo(90),
          latestActivitySentiment: "NEGATIF",
          primaryOpenDeal: { updatedAt: daysAgo(90) },
        }),
        NOW,
      ),
    ];
    const summary = summarizeHealth(results);
    expect(summary).toEqual({
      companyCount: 3,
      healthyCount: 1,
      atRiskCount: 1,
      criticalCount: 1,
    });
  });
});

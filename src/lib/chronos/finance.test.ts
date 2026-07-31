import { describe, expect, it } from "vitest";
import {
  byMarketplace,
  cashPosition,
  costBreakdown,
  extremes,
  financeKpis,
  inPeriod,
  monthlyPnl,
  periodStart,
  type SoldUnit,
} from "./finance";
import { computeUnitMargin, type UnitMarginInput } from "./margin";

const NOW = new Date(Date.UTC(2026, 6, 26)); // 2026-07-26
const DAY = 86_400_000;

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

/**
 * Builds a SoldUnit through the real margin computation rather than hand-rolled
 * numbers — these rollups exist to sum margin.ts's output, so a fixture that
 * bypasses it would let the two drift.
 */
function unit(
  id: string,
  over: Partial<UnitMarginInput> & { soldOn?: string | null } = {},
): SoldUnit {
  const { soldOn = "ebay", ...marginOver } = over;
  const input: UnitMarginInput = {
    unitId: id,
    sku: `WCH-${id}`,
    acquiredAt: utc(2026, 5, 1),
    soldAt: null,
    salePriceCents: null,
    saleFxRate: null,
    vatScheme: "EXEMPT", // keep VAT out of the arithmetic unless a test wants it
    vatRatePct: 23,
    costs: [{ kind: "ACQUISITION", baseAmountCents: 50_000 }],
    ...marginOver,
  };
  return {
    unitId: id,
    sku: input.sku,
    soldAt: input.soldAt,
    soldOn: input.soldAt ? soldOn : null,
    margin: computeUnitMargin(input, NOW),
  };
}

describe("periodStart", () => {
  it("returns null for 'tout' so nothing is excluded", () => {
    expect(periodStart("tout", NOW)).toBeNull();
  });

  it("starts at the first of the month n-1 months back, not n days back", () => {
    // "3 mois" on 2026-07-26 = May, June, July — three whole columns.
    expect(periodStart("3m", NOW)).toEqual(utc(2026, 4, 1));
  });

  it("crosses a year boundary", () => {
    expect(periodStart("12m", NOW)).toEqual(utc(2025, 7, 1));
  });
});

describe("inPeriod", () => {
  const sold = unit("a", { soldAt: utc(2026, 6, 10), salePriceCents: 80_000 });
  const old = unit("b", { soldAt: utc(2025, 0, 10), salePriceCents: 80_000 });
  const stock = unit("c");

  it("keeps only sold units inside the window", () => {
    expect(inPeriod([sold, old, stock], periodStart("3m", NOW)).map((u) => u.unitId)).toEqual([
      "a",
    ]);
  });

  it("drops units still in stock even with no lower bound", () => {
    expect(inPeriod([sold, old, stock], null).map((u) => u.unitId)).toEqual(["a", "b"]);
  });
});

describe("monthlyPnl", () => {
  it("emits empty months instead of closing the gap", () => {
    const units = [unit("a", { soldAt: utc(2026, 4, 5), salePriceCents: 80_000 })];
    const points = monthlyPnl(units, { start: periodStart("3m", NOW), now: NOW });

    expect(points.map((p) => p.month)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(points[1].soldCount).toBe(0);
    expect(points[1].revenueCents).toBe(0);
  });

  it("attributes revenue, cost and net margin to the month of sale", () => {
    const units = [
      unit("a", { soldAt: utc(2026, 5, 5), salePriceCents: 80_000 }),
      unit("b", { soldAt: utc(2026, 5, 20), salePriceCents: 90_000 }),
      unit("c", { soldAt: utc(2026, 6, 2), salePriceCents: 70_000 }),
    ];
    const points = monthlyPnl(units, { start: periodStart("3m", NOW), now: NOW });
    const june = points.find((p) => p.month === "2026-06")!;

    expect(june.soldCount).toBe(2);
    expect(june.revenueCents).toBe(170_000);
    expect(june.costCents).toBe(100_000);
    expect(june.netMarginCents).toBe(70_000);
  });

  it("returns nothing when there are no sales and no lower bound", () => {
    expect(monthlyPnl([unit("a")], { start: null, now: NOW })).toEqual([]);
  });

  it("parks a future-dated sale in the last column rather than dropping it", () => {
    const units = [unit("a", { soldAt: utc(2026, 9, 1), salePriceCents: 80_000 })];
    const points = monthlyPnl(units, { start: periodStart("3m", NOW), now: NOW });

    expect(points.at(-1)!.month).toBe("2026-07");
    expect(points.at(-1)!.revenueCents).toBe(80_000);
    // The bars must still reconcile against the KPI tiles.
    expect(points.reduce((s, p) => s + p.revenueCents, 0)).toBe(
      financeKpis(inPeriod(units, periodStart("3m", NOW))).revenueCents,
    );
  });
});

describe("costBreakdown", () => {
  it("sums each waterfall group across the period", () => {
    const units = [
      unit("a", {
        soldAt: utc(2026, 6, 1),
        salePriceCents: 100_000,
        costs: [
          { kind: "ACQUISITION", baseAmountCents: 50_000 },
          { kind: "PART", baseAmountCents: 4_000 },
          { kind: "LABOUR", baseAmountCents: 6_000 },
          { kind: "MARKETPLACE_FEE", baseAmountCents: 12_000 },
        ],
      }),
      unit("b", {
        soldAt: utc(2026, 6, 2),
        salePriceCents: 60_000,
        costs: [{ kind: "ACQUISITION", baseAmountCents: 30_000 }],
      }),
    ];

    expect(costBreakdown(units)).toEqual({
      acquisition: 80_000,
      restoration: 10_000,
      logistics: 0,
      fees: 12_000,
      refunds: 0,
      other: 0,
    });
  });
});

describe("byMarketplace", () => {
  const units = [
    unit("a", { soldAt: utc(2026, 6, 1), salePriceCents: 100_000, soldOn: "ebay" }),
    unit("b", { soldAt: utc(2026, 6, 2), salePriceCents: 200_000, soldOn: "chrono24" }),
    unit("c", { soldAt: utc(2026, 6, 3), salePriceCents: 60_000, soldOn: null }),
  ];

  it("ranks channels by net margin and buckets a direct sale under ''", () => {
    const rows = byMarketplace(units);
    expect(rows.map((r) => r.key)).toEqual(["chrono24", "ebay", ""]);
  });

  it("computes margin % as net over revenue, not a mean of percentages", () => {
    const rows = byMarketplace([
      unit("a", { soldAt: utc(2026, 6, 1), salePriceCents: 100_000, soldOn: "ebay" }),
      unit("b", { soldAt: utc(2026, 6, 2), salePriceCents: 300_000, soldOn: "ebay" }),
    ]);
    // net 300_000 over revenue 400_000 = 75%, not the 50/83 mean of 66.7%.
    expect(rows[0].marginPct).toBeCloseTo(75, 6);
  });

  it("breaks fees out of total cost", () => {
    const rows = byMarketplace([
      unit("a", {
        soldAt: utc(2026, 6, 1),
        salePriceCents: 100_000,
        soldOn: "ebay",
        costs: [
          { kind: "ACQUISITION", baseAmountCents: 50_000 },
          { kind: "MARKETPLACE_FEE", baseAmountCents: 11_000 },
          { kind: "PAYMENT_FEE", baseAmountCents: 2_000 },
        ],
      }),
    ]);
    expect(rows[0].feesCents).toBe(13_000);
  });
});

describe("extremes", () => {
  const units = [10, 20, 30, 40].map((k, i) =>
    unit(String(i), {
      soldAt: utc(2026, 6, 1),
      salePriceCents: 50_000 + k * 1_000,
    }),
  );

  it("returns best first and worst first", () => {
    const { best, worst } = extremes(units, 2);
    expect(best.map((u) => u.sku)).toEqual(["WCH-3", "WCH-2"]);
    expect(worst.map((u) => u.sku)).toEqual(["WCH-0", "WCH-1"]);
  });

  it("never lists the same unit in both halves", () => {
    const { best, worst } = extremes(units.slice(0, 3), 5);
    const overlap = best.filter((b) => worst.some((w) => w.unitId === b.unitId));
    expect(overlap).toEqual([]);
  });

  it("leaves worst empty when a single sale cannot be split", () => {
    expect(extremes(units.slice(0, 1), 5).worst).toEqual([]);
  });
});

describe("cashPosition", () => {
  it("counts only stock, in fixed buckets, including empty ones", () => {
    const units = [
      unit("fresh", { acquiredAt: new Date(NOW.getTime() - 5 * DAY) }),
      unit("stale", { acquiredAt: new Date(NOW.getTime() - 200 * DAY) }),
      unit("gone", { soldAt: utc(2026, 6, 1), salePriceCents: 90_000 }),
    ];
    const pos = cashPosition(units);

    expect(pos.inStockCount).toBe(2);
    expect(pos.cashTiedUpCents).toBe(100_000);
    expect(pos.ageing.map((a) => a.bucket)).toEqual(["0-30", "30-90", "90+"]);
    expect(pos.ageing[1]).toEqual({ bucket: "30-90", unitCount: 0, cashTiedUpCents: 0 });
    expect(pos.staleCashCents).toBe(50_000);
  });
});

describe("financeKpis", () => {
  it("reports realised P&L over sold units", () => {
    const units = inPeriod(
      [
        unit("a", { soldAt: utc(2026, 6, 1), salePriceCents: 100_000 }),
        unit("b", { soldAt: utc(2026, 6, 2), salePriceCents: 40_000 }),
        unit("c"),
      ],
      periodStart("3m", NOW),
    );
    const kpis = financeKpis(units);

    expect(kpis.soldCount).toBe(2);
    expect(kpis.revenueCents).toBe(140_000);
    expect(kpis.cogsCents).toBe(100_000);
    expect(kpis.netMarginCents).toBe(40_000);
    expect(kpis.marginPct).toBeCloseTo(28.571, 3);
  });

  it("carries VAT through under the margin scheme", () => {
    const kpis = financeKpis([
      unit("a", {
        soldAt: utc(2026, 6, 1),
        salePriceCents: 100_000,
        vatScheme: "MARGIN",
        vatRatePct: 23,
      }),
    ]);
    // margin 50_000 inclusive of 23% VAT → 50_000 * 23/123.
    expect(kpis.vatCents).toBe(9_350);
    expect(kpis.netMarginCents).toBe(100_000 - 50_000 - 9_350);
  });

  it("returns null margin % with no revenue rather than 0", () => {
    expect(financeKpis([]).marginPct).toBeNull();
  });
});

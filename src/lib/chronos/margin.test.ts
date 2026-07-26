import { describe, expect, it } from "vitest";
import {
  computeUnitMargin,
  estimateFees,
  groupForKind,
  marginSchemeVatCents,
  summarizeMargins,
  toCents,
  type UnitMarginInput,
} from "./margin";

const NOW = new Date(2026, 6, 26); // 2026-07-26

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function baseInput(overrides: Partial<UnitMarginInput> = {}): UnitMarginInput {
  return {
    unitId: "u1",
    sku: "WCH-0001",
    acquiredAt: daysAgo(60),
    soldAt: null,
    salePriceCents: null,
    saleFxRate: null,
    vatScheme: "MARGIN",
    vatRatePct: 23,
    costs: [{ kind: "ACQUISITION", baseAmountCents: 50_000 }],
    ...overrides,
  };
}

describe("marginSchemeVatCents", () => {
  it("applies rate/(100+rate), NOT rate/100 — the margin is VAT-inclusive", () => {
    // 1000,00 € sale on a 500,00 € purchase = 500,00 € gross margin at 23%.
    // Correct: 50000 * 23/123 = 9349.59 -> 9350 cents (93,50 €).
    // The wrong /100 form gives 11500 (115,00 €) — 23% too much VAT.
    expect(marginSchemeVatCents(100_000, 50_000, 23)).toBe(9350);
    expect(marginSchemeVatCents(100_000, 50_000, 23)).not.toBe(11_500);
  });

  it("is zero on a break-even sale", () => {
    expect(marginSchemeVatCents(50_000, 50_000, 23)).toBe(0);
  });

  it("is zero on a loss — no margin to tax, and never negative VAT", () => {
    expect(marginSchemeVatCents(40_000, 50_000, 23)).toBe(0);
  });

  it("is zero at a zero rate", () => {
    expect(marginSchemeVatCents(100_000, 50_000, 0)).toBe(0);
  });
});

describe("computeUnitMargin — VAT schemes", () => {
  const sold = {
    soldAt: daysAgo(10),
    salePriceCents: 100_000,
    costs: [{ kind: "ACQUISITION", baseAmountCents: 50_000 }],
  };

  it("MARGIN taxes only (sale − acquisition)", () => {
    const r = computeUnitMargin(baseInput({ ...sold, vatScheme: "MARGIN" }), NOW);
    expect(r.vatCents).toBe(9350);
    expect(r.netMarginCents).toBe(100_000 - 50_000 - 9350);
  });

  it("STANDARD taxes the whole sale price, also VAT-inclusive", () => {
    const r = computeUnitMargin(baseInput({ ...sold, vatScheme: "STANDARD" }), NOW);
    expect(r.vatCents).toBe(Math.round((100_000 * 23) / 123));
  });

  it("EXEMPT charges nothing", () => {
    const r = computeUnitMargin(baseInput({ ...sold, vatScheme: "EXEMPT" }), NOW);
    expect(r.vatCents).toBe(0);
    expect(r.netMarginCents).toBe(50_000);
  });

  it("charges no VAT on an unsold unit", () => {
    expect(computeUnitMargin(baseInput(), NOW).vatCents).toBe(0);
  });
});

describe("computeUnitMargin — cost groups", () => {
  it("buckets every known kind into its group", () => {
    const r = computeUnitMargin(
      baseInput({
        costs: [
          { kind: "ACQUISITION", baseAmountCents: 50_000 },
          { kind: "PART", baseAmountCents: 2_000 },
          { kind: "CONSUMABLE", baseAmountCents: 500 },
          { kind: "LABOUR", baseAmountCents: 7_000 },
          { kind: "TOOL_ALLOCATION", baseAmountCents: 1_000 },
          { kind: "SHIPPING_IN", baseAmountCents: 1_500 },
          { kind: "SHIPPING_OUT", baseAmountCents: 1_200 },
          { kind: "DUTY", baseAmountCents: 800 },
          { kind: "MARKETPLACE_FEE", baseAmountCents: 12_800 },
          { kind: "PAYMENT_FEE", baseAmountCents: 300 },
          { kind: "REFUND", baseAmountCents: 4_000 },
        ],
      }),
      NOW,
    );
    expect(r.groups.acquisition).toBe(50_000);
    expect(r.groups.restoration).toBe(10_500);
    expect(r.groups.logistics).toBe(3_500);
    expect(r.groups.fees).toBe(13_100);
    expect(r.groups.refunds).toBe(4_000);
    expect(r.groups.other).toBe(0);
    expect(r.totalCostCents).toBe(81_100);
  });

  it("sums an unknown kind into `other` rather than dropping it", () => {
    expect(groupForKind("SOMETHING_NEW")).toBe("other");
    const r = computeUnitMargin(
      baseInput({ costs: [{ kind: "SOMETHING_NEW", baseAmountCents: 999 }] }),
      NOW,
    );
    expect(r.groups.other).toBe(999);
    expect(r.totalCostCents).toBe(999);
  });

  it("a refund can push a profitable sale negative", () => {
    const r = computeUnitMargin(
      baseInput({
        soldAt: daysAgo(5),
        salePriceCents: 60_000,
        vatScheme: "EXEMPT",
        costs: [
          { kind: "ACQUISITION", baseAmountCents: 50_000 },
          { kind: "REFUND", baseAmountCents: 20_000 },
        ],
      }),
      NOW,
    );
    expect(r.netMarginCents).toBe(-10_000);
    expect(r.marginPct).toBeCloseTo(-16.667, 2);
  });
});

describe("computeUnitMargin — currency", () => {
  it("converts the sale price at saleFxRate", () => {
    const r = computeUnitMargin(
      baseInput({
        soldAt: daysAgo(1),
        salePriceCents: 100_000, // 1000,00 GBP
        saleFxRate: 1.17,
        vatScheme: "EXEMPT",
      }),
      NOW,
    );
    expect(r.revenueCents).toBe(117_000);
  });

  it("treats a null or zero fx rate as 1:1 rather than zeroing revenue", () => {
    for (const rate of [null, 0]) {
      const r = computeUnitMargin(
        baseInput({ soldAt: daysAgo(1), salePriceCents: 100_000, saleFxRate: rate }),
        NOW,
      );
      expect(r.revenueCents).toBe(100_000);
    }
  });
});

describe("computeUnitMargin — unsold units", () => {
  it("reports zero revenue, null margin %, and cash tied up", () => {
    const r = computeUnitMargin(baseInput(), NOW);
    expect(r.sold).toBe(false);
    expect(r.revenueCents).toBe(0);
    expect(r.marginPct).toBeNull();
    expect(r.marginPerDayCents).toBeNull();
    expect(r.cashTiedUpCents).toBe(50_000);
  });

  it("frees the cash once sold", () => {
    const r = computeUnitMargin(
      baseInput({ soldAt: daysAgo(1), salePriceCents: 80_000 }),
      NOW,
    );
    expect(r.cashTiedUpCents).toBe(0);
  });
});

describe("computeUnitMargin — days held and margin per day", () => {
  it("measures acquisition → sale for a sold unit", () => {
    const r = computeUnitMargin(
      baseInput({
        acquiredAt: daysAgo(100),
        soldAt: daysAgo(60),
        salePriceCents: 80_000,
        vatScheme: "EXEMPT",
      }),
      NOW,
    );
    expect(r.daysHeld).toBe(40);
    expect(r.marginPerDayCents).toBe(Math.round(30_000 / 40));
  });

  it("measures acquisition → now for a unit still in stock", () => {
    expect(computeUnitMargin(baseInput({ acquiredAt: daysAgo(17) }), NOW).daysHeld).toBe(17);
  });

  it("floors the denominator at one day on a same-day flip", () => {
    const at = daysAgo(3);
    const r = computeUnitMargin(
      baseInput({
        acquiredAt: at,
        soldAt: at,
        salePriceCents: 80_000,
        vatScheme: "EXEMPT",
      }),
      NOW,
    );
    expect(r.daysHeld).toBe(0);
    expect(r.marginPerDayCents).toBe(30_000);
  });

  it("is null when the acquisition date is unknown", () => {
    const r = computeUnitMargin(baseInput({ acquiredAt: null }), NOW);
    expect(r.daysHeld).toBeNull();
    expect(r.marginPerDayCents).toBeNull();
  });

  it("ranks a fast small win above a slow large one", () => {
    const fast = computeUnitMargin(
      baseInput({ acquiredAt: daysAgo(42), soldAt: NOW, salePriceCents: 59_000, vatScheme: "EXEMPT" }),
      NOW,
    );
    const slow = computeUnitMargin(
      baseInput({ acquiredAt: daysAgo(240), soldAt: NOW, salePriceCents: 70_000, vatScheme: "EXEMPT" }),
      NOW,
    );
    expect(slow.netMarginCents).toBeGreaterThan(fast.netMarginCents);
    expect(fast.marginPerDayCents!).toBeGreaterThan(slow.marginPerDayCents!);
  });
});

describe("summarizeMargins", () => {
  const margins = [
    // In stock, three ageing buckets.
    computeUnitMargin(baseInput({ unitId: "a", acquiredAt: daysAgo(5), costs: [{ kind: "ACQUISITION", baseAmountCents: 10_000 }] }), NOW),
    computeUnitMargin(baseInput({ unitId: "b", acquiredAt: daysAgo(45), costs: [{ kind: "ACQUISITION", baseAmountCents: 20_000 }] }), NOW),
    computeUnitMargin(baseInput({ unitId: "c", acquiredAt: daysAgo(200), costs: [{ kind: "ACQUISITION", baseAmountCents: 30_000 }] }), NOW),
    // Sold.
    computeUnitMargin(baseInput({ unitId: "d", acquiredAt: daysAgo(40), soldAt: daysAgo(20), salePriceCents: 100_000, vatScheme: "EXEMPT", costs: [{ kind: "ACQUISITION", baseAmountCents: 60_000 }] }), NOW),
  ];
  const s = summarizeMargins(margins);

  it("splits stock from sales", () => {
    expect(s.unitCount).toBe(4);
    expect(s.inStockCount).toBe(3);
    expect(s.soldCount).toBe(1);
  });

  it("counts cash tied up in unsold stock only", () => {
    expect(s.cashTiedUpCents).toBe(60_000);
  });

  it("ages that cash into 0-30 / 30-90 / 90+", () => {
    expect(s.ageing).toEqual([
      { bucket: "0-30", unitCount: 1, cashTiedUpCents: 10_000 },
      { bucket: "30-90", unitCount: 1, cashTiedUpCents: 20_000 },
      { bucket: "90+", unitCount: 1, cashTiedUpCents: 30_000 },
    ]);
  });

  it("counts realised money from sold units only", () => {
    expect(s.revenueCents).toBe(100_000);
    expect(s.netMarginCents).toBe(40_000);
    expect(s.marginPct).toBeCloseTo(40, 5);
  });

  it("puts a boundary day in the upper bucket", () => {
    const at30 = computeUnitMargin(baseInput({ acquiredAt: daysAgo(30) }), NOW);
    const at90 = computeUnitMargin(baseInput({ acquiredAt: daysAgo(90) }), NOW);
    expect(summarizeMargins([at30]).ageing[1].unitCount).toBe(1);
    expect(summarizeMargins([at90]).ageing[2].unitCount).toBe(1);
  });

  it("returns nulls rather than NaN with no sales", () => {
    const empty = summarizeMargins([computeUnitMargin(baseInput(), NOW)]);
    expect(empty.marginPct).toBeNull();
    expect(empty.avgMarginPerDayCents).toBeNull();
  });
});

describe("estimateFees", () => {
  it("sums the percentage components and the fixed fee", () => {
    // eBay defaults: 12.8% + 0.35% regulatory + 30c fixed on a 1000,00 € sale.
    expect(
      estimateFees(100_000, { finalValuePct: 12.8, fixedCents: 30, paymentPct: 0, regulatoryPct: 0.35 }),
    ).toBe(13_180);
  });

  it("is zero with no fee model or no sale price", () => {
    expect(estimateFees(100_000, undefined)).toBe(0);
    expect(estimateFees(0, { finalValuePct: 12.8 })).toBe(0);
  });
});

describe("toCents", () => {
  it("parses the French form with a comma decimal and space thousands", () => {
    expect(toCents("1 234,56")).toBe(123_456);
    expect(toCents("1 234,56")).toBe(123_456); // narrow nbsp
  });

  it("parses the plain form and a bare number", () => {
    expect(toCents("1234.56")).toBe(123_456);
    expect(toCents(1234.56)).toBe(123_456);
    expect(toCents("450")).toBe(45_000);
  });

  it("rounds the scaled value, so float artefacts don't lose a cent", () => {
    expect(toCents("19.99")).toBe(1_999);
    expect(toCents(19.99)).toBe(1_999);
  });

  it("strips a currency symbol", () => {
    expect(toCents("1 200,00 €")).toBe(120_000);
  });

  it("returns null on junk rather than booking a silent zero", () => {
    expect(toCents("")).toBeNull();
    expect(toCents("abc")).toBeNull();
    expect(toCents("12,34,56")).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
  });
});

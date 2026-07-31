import { describe, expect, it } from "vitest";
import type { ConnectorOrder } from "./connectors/types";
import {
  mapOrderToUnitWrites,
  normaliseFeeKind,
  totalFeesBaseCents,
  type MapOrderOptions,
} from "./sync-map";

const SOLD_AT = new Date("2026-07-20T10:30:00.000Z");

const OPTS: MapOrderOptions = { provider: "ebay", baseCurrency: "EUR" };

function order(overrides: Partial<ConnectorOrder> = {}): ConnectorOrder {
  return {
    externalId: "12-34567-89012",
    soldAt: SOLD_AT,
    currency: "EUR",
    grossCents: 125000,
    lines: [
      {
        sku: "WCH-0005",
        title: "Seiko SKX007",
        quantity: 1,
        grossCents: 125000,
        currency: "EUR",
        fees: [
          { kind: "FINAL_VALUE_FEE", label: "Final value fee", amountCents: 16000, currency: "EUR" },
          { kind: "REGULATORY_OPERATING_FEE", label: "Regulatory", amountCents: 438, currency: "EUR" },
        ],
      },
    ],
    ...overrides,
  };
}

describe("normaliseFeeKind", () => {
  it("maps eBay fee codes onto Chronos cost kinds", () => {
    expect(normaliseFeeKind("FINAL_VALUE_FEE")).toBe("MARKETPLACE_FEE");
    expect(normaliseFeeKind("REGULATORY_OPERATING_FEE")).toBe("MARKETPLACE_FEE");
    expect(normaliseFeeKind("AD_FEE")).toBe("MARKETPLACE_FEE");
    expect(normaliseFeeKind("PAYMENT_PROCESSING_FEE")).toBe("PAYMENT_FEE");
    expect(normaliseFeeKind("IMPORT_CHARGES")).toBe("DUTY");
    expect(normaliseFeeKind("REFUND")).toBe("REFUND");
  });

  it("is insensitive to case and separators — CSV exports are not consistent", () => {
    for (const v of ["finalValueFee", "final value fee", "FINAL-VALUE-FEE", "Final_Value_Fee"]) {
      expect(normaliseFeeKind(v)).toBe("MARKETPLACE_FEE");
    }
  });

  it("keeps an unknown fee as OTHER rather than dropping it", () => {
    // Dropping an unrecognised fee would silently OVERSTATE margin, which is
    // worse than filing it imprecisely.
    expect(normaliseFeeKind("SOME_NEW_2027_LEVY")).toBe("OTHER");
    expect(normaliseFeeKind("")).toBe("OTHER");
  });
});

describe("mapOrderToUnitWrites — matching", () => {
  it("maps a clean single-line order to sale facts plus fee lines", () => {
    const { matched, unmatched } = mapOrderToUnitWrites(order(), OPTS);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);

    const line = matched[0];
    expect(line.sku).toBe("WCH-0005");
    expect(line.sale).toEqual({
      soldAt: SOLD_AT,
      soldOn: "ebay",
      saleExternalId: "12-34567-89012",
      salePriceCents: 125000,
      saleCurrency: "EUR",
      saleFxRate: 1,
    });
    expect(line.costs.map((c) => c.kind)).toEqual(["MARKETPLACE_FEE", "MARKETPLACE_FEE"]);
    expect(line.costs.map((c) => c.amountCents)).toEqual([16000, 438]);
    expect(line.costs.every((c) => c.incurredAt === SOLD_AT)).toBe(true);
  });

  it("trims a padded SKU", () => {
    const o = order();
    o.lines[0].sku = "  WCH-0005  ";
    expect(mapOrderToUnitWrites(o, OPTS).matched[0].sku).toBe("WCH-0005");
  });
});

describe("mapOrderToUnitWrites — never guessing", () => {
  it("sends a SKU-less line to reconciliation and writes nothing", () => {
    const o = order();
    o.lines[0].sku = null;
    const { matched, unmatched } = mapOrderToUnitWrites(o, OPTS);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([
      {
        reason: "no_sku",
        sku: null,
        title: "Seiko SKX007",
        quantity: 1,
        grossCents: 125000,
        currency: "EUR",
      },
    ]);
  });

  it("treats an empty-string SKU as absent", () => {
    const o = order();
    o.lines[0].sku = "   ";
    expect(mapOrderToUnitWrites(o, OPTS).unmatched[0].reason).toBe("no_sku");
  });

  it("refuses a quantity>1 line — one unit is one physical item", () => {
    const o = order();
    o.lines[0].quantity = 3;
    const { matched, unmatched } = mapOrderToUnitWrites(o, OPTS);
    expect(matched).toEqual([]);
    expect(unmatched[0]).toMatchObject({ reason: "multi_quantity", sku: "WCH-0005", quantity: 3 });
  });

  it("keeps matched and unmatched lines of one order apart", () => {
    const o = order({
      lines: [
        { sku: "WCH-0005", title: "A", quantity: 1, grossCents: 100000, currency: "EUR", fees: [] },
        { sku: null, title: "B", quantity: 1, grossCents: 25000, currency: "EUR", fees: [] },
      ],
    });
    const { matched, unmatched } = mapOrderToUnitWrites(o, OPTS);
    expect(matched.map((m) => m.sku)).toEqual(["WCH-0005"]);
    expect(unmatched.map((u) => u.title)).toEqual(["B"]);
  });
});

describe("mapOrderToUnitWrites — dedupe keys", () => {
  it("is deterministic across runs: identical input, identical keys", () => {
    const a = mapOrderToUnitWrites(order(), OPTS).matched[0].costs.map((c) => c.dedupeKey);
    const b = mapOrderToUnitWrites(order(), OPTS).matched[0].costs.map((c) => c.dedupeKey);
    expect(a).toEqual(b);
    // This is the whole re-sync guard: a re-run upserts onto the same rows.
    expect(a).toEqual([
      "ebay:12-34567-89012:0:marketplace_fee:0",
      "ebay:12-34567-89012:0:marketplace_fee:1",
    ]);
  });

  it("namespaces by provider so eBay and a CSV import cannot collide", () => {
    const key = mapOrderToUnitWrites(order(), { ...OPTS, provider: "chrono24" }).matched[0]
      .costs[0].dedupeKey;
    expect(key.startsWith("chrono24:")).toBe(true);
  });

  it("gives repeated fee kinds distinct ordinals", () => {
    const o = order();
    o.lines[0].fees = [
      { kind: "AD_FEE", label: "Ad 1", amountCents: 100, currency: "EUR" },
      { kind: "PAYMENT_PROCESSING_FEE", label: "Payment", amountCents: 200, currency: "EUR" },
      { kind: "AD_FEE", label: "Ad 2", amountCents: 300, currency: "EUR" },
    ];
    const keys = mapOrderToUnitWrites(o, OPTS).matched[0].costs.map((c) => c.dedupeKey);
    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual([
      "ebay:12-34567-89012:0:marketplace_fee:0",
      "ebay:12-34567-89012:0:payment_fee:0",
      "ebay:12-34567-89012:0:marketplace_fee:1",
    ]);
  });

  it("gives each line of a multi-line order its own key space", () => {
    const o = order({
      lines: [
        {
          sku: "A",
          title: "A",
          quantity: 1,
          grossCents: 1000,
          currency: "EUR",
          fees: [{ kind: "FINAL_VALUE_FEE", label: "f", amountCents: 10, currency: "EUR" }],
        },
        {
          sku: "B",
          title: "B",
          quantity: 1,
          grossCents: 2000,
          currency: "EUR",
          fees: [{ kind: "FINAL_VALUE_FEE", label: "f", amountCents: 20, currency: "EUR" }],
        },
      ],
    });
    const { matched } = mapOrderToUnitWrites(o, OPTS);
    expect(matched[0].costs[0].dedupeKey).toBe("ebay:12-34567-89012:0:marketplace_fee:0");
    expect(matched[1].costs[0].dedupeKey).toBe("ebay:12-34567-89012:1:marketplace_fee:0");
  });
});

describe("mapOrderToUnitWrites — currency", () => {
  it("uses 1:1 when the order is already in base currency", () => {
    const { matched } = mapOrderToUnitWrites(order(), OPTS);
    expect(matched[0].sale.saleFxRate).toBe(1);
    expect(matched[0].costs.every((c) => c.fxRate === 1)).toBe(true);
  });

  it("applies the configured rate for a foreign-currency sale", () => {
    const o = order({ currency: "GBP" });
    o.lines[0].currency = "GBP";
    o.lines[0].fees = [{ kind: "FINAL_VALUE_FEE", label: "f", amountCents: 10000, currency: "GBP" }];
    const { matched } = mapOrderToUnitWrites(o, { ...OPTS, fxRates: { GBP: 1.17 } });
    expect(matched[0].sale.saleCurrency).toBe("GBP");
    expect(matched[0].sale.saleFxRate).toBe(1.17);
    expect(totalFeesBaseCents(matched[0])).toBe(11700);
  });

  it("falls back to 1:1 rather than dropping a line when a rate is missing", () => {
    const o = order({ currency: "USD" });
    o.lines[0].currency = "USD";
    const { matched } = mapOrderToUnitWrites(o, { ...OPTS, fxRates: { GBP: 1.17 } });
    expect(matched[0].sale.saleFxRate).toBe(1);
  });

  it("handles a fee denominated differently from its line", () => {
    const o = order();
    o.lines[0].fees = [{ kind: "IMPORT_CHARGES", label: "duty", amountCents: 5000, currency: "GBP" }];
    const { matched } = mapOrderToUnitWrites(o, { ...OPTS, fxRates: { GBP: 1.17 } });
    expect(matched[0].costs[0]).toMatchObject({ kind: "DUTY", currency: "GBP", fxRate: 1.17 });
  });
});

describe("mapOrderToUnitWrites — amounts", () => {
  it("takes the magnitude of a negatively-reported fee", () => {
    // addUnitCost rejects negatives outright: kind carries the sign, not the
    // number. A credit reported as -1600 must not reach it as -1600.
    const o = order();
    o.lines[0].fees = [{ kind: "REFUND", label: "credit", amountCents: -1600, currency: "EUR" }];
    const { matched } = mapOrderToUnitWrites(o, OPTS);
    expect(matched[0].costs[0]).toMatchObject({ kind: "REFUND", amountCents: 1600 });
  });

  it("rounds fractional cents to integers", () => {
    const o = order();
    o.lines[0].grossCents = 125000.4;
    o.lines[0].fees = [{ kind: "AD_FEE", label: "ad", amountCents: 99.6, currency: "EUR" }];
    const { matched } = mapOrderToUnitWrites(o, OPTS);
    expect(Number.isInteger(matched[0].sale.salePriceCents)).toBe(true);
    expect(matched[0].sale.salePriceCents).toBe(125000);
    expect(matched[0].costs[0].amountCents).toBe(100);
  });

  it("accepts a fee-free order", () => {
    const o = order();
    o.lines[0].fees = [];
    const { matched } = mapOrderToUnitWrites(o, OPTS);
    expect(matched[0].costs).toEqual([]);
    expect(totalFeesBaseCents(matched[0])).toBe(0);
  });

  it("labels a fee by its kind when the upstream label is empty", () => {
    const o = order();
    o.lines[0].fees = [{ kind: "FINAL_VALUE_FEE", label: "", amountCents: 100, currency: "EUR" }];
    expect(mapOrderToUnitWrites(o, OPTS).matched[0].costs[0].label).toBe("MARKETPLACE_FEE");
  });

  it("stamps the source so synced lines are distinguishable from manual ones", () => {
    const { matched } = mapOrderToUnitWrites(order(), OPTS);
    expect(matched[0].costs[0].source).toBe("EBAY_ORDER");
    const csv = mapOrderToUnitWrites(order(), { ...OPTS, provider: "vinted", source: "IMPORT" });
    expect(csv.matched[0].costs[0].source).toBe("IMPORT");
  });
});

import { describe, expect, it } from "vitest";
import {
  missingRequiredColumns,
  parseSaleRows,
  suggestSaleMapping,
  type SaleMapping,
} from "./sale-import";
import { mapOrderToUnitWrites } from "./sync-map";

const MAPPING: SaleMapping = {
  sku: "SKU",
  externalId: "Commande",
  soldAt: "Date de vente",
  grossAmount: "Montant",
  currency: "Devise",
  marketplaceFee: "Commission",
  shippingOut: "Frais de port",
};

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    SKU: "WCH-0007",
    Commande: "C24-88120",
    "Date de vente": "12/05/2026",
    Montant: "1 850,00",
    Devise: "EUR",
    Commission: "120,25",
    "Frais de port": "18,00",
    ...overrides,
  };
}

describe("suggestSaleMapping", () => {
  it("matches French export headers", () => {
    const m = suggestSaleMapping([
      "SKU",
      "Numéro de commande",
      "Date de vente",
      "Prix de vente",
      "Devise",
      "Commission",
    ]);
    expect(m.sku).toBe("SKU");
    expect(m.externalId).toBe("Numéro de commande");
    expect(m.soldAt).toBe("Date de vente");
    expect(m.grossAmount).toBe("Prix de vente");
    expect(m.marketplaceFee).toBe("Commission");
  });

  it("matches English export headers", () => {
    const m = suggestSaleMapping(["Custom label", "Order ID", "Sold date", "Sale price", "Final value fee"]);
    expect(m.sku).toBe("Custom label");
    expect(m.externalId).toBe("Order ID");
    expect(m.soldAt).toBe("Sold date");
    expect(m.grossAmount).toBe("Sale price");
    expect(m.marketplaceFee).toBe("Final value fee");
  });

  it("never assigns one header to two columns", () => {
    const m = suggestSaleMapping(["Reference", "Order ID", "Date", "Total"]);
    const assigned = Object.values(m);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("leaves unrecognisable headers unmapped rather than guessing", () => {
    const m = suggestSaleMapping(["colonne A", "colonne B"]);
    expect(missingRequiredColumns(m).sort()).toEqual(
      ["externalId", "grossAmount", "sku", "soldAt"].sort(),
    );
  });
});

describe("parseSaleRows", () => {
  it("turns a clean row into a ConnectorOrder with fee lines", () => {
    const { orders, errors } = parseSaleRows([row()], MAPPING);
    expect(errors).toEqual([]);
    expect(orders).toHaveLength(1);

    const o = orders[0];
    expect(o.externalId).toBe("C24-88120");
    expect(o.grossCents).toBe(185000);
    expect(o.currency).toBe("EUR");
    expect(o.lines[0].sku).toBe("WCH-0007");
    expect(o.lines[0].fees).toEqual([
      { kind: "MARKETPLACE_FEE", label: "Commission marketplace", amountCents: 12025, currency: "EUR" },
      { kind: "SHIPPING_OUT", label: "Frais de port", amountCents: 1800, currency: "EUR" },
    ]);
  });

  it("reports an unreadable date and writes nothing for that row", () => {
    const { orders, errors } = parseSaleRows([row({ "Date de vente": "pas une date" })], MAPPING);
    expect(orders).toEqual([]);
    expect(errors[0]).toMatchObject({ rowNumber: 2, message: expect.stringContaining("Date") });
  });

  it("reports an unreadable amount rather than importing a zero", () => {
    // A silent 0 here would show a 100%-loss unit and look like a real result.
    const { orders, errors } = parseSaleRows([row({ Montant: "n/a" })], MAPPING);
    expect(orders).toEqual([]);
    expect(errors[0].message).toContain("Montant");
  });

  it("rejects the whole row when a fee column is malformed", () => {
    const { orders, errors } = parseSaleRows([row({ Commission: "??" })], MAPPING);
    expect(orders).toEqual([]);
    expect(errors[0].message).toContain("Commission");
  });

  it("skips a blank trailing row without reporting an error", () => {
    const blank = { SKU: "", Commande: "", "Date de vente": "", Montant: "" };
    const { orders, errors } = parseSaleRows([row(), blank], MAPPING);
    expect(orders).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("keeps a missing SKU as null so the mapper queues it", () => {
    const { orders } = parseSaleRows([row({ SKU: "" })], MAPPING);
    expect(orders[0].lines[0].sku).toBeNull();
    const mapped = mapOrderToUnitWrites(orders[0], { provider: "chrono24", baseCurrency: "EUR" });
    expect(mapped.matched).toEqual([]);
    expect(mapped.unmatched[0].reason).toBe("no_sku");
  });

  it("drops zero-valued fee columns instead of writing 0-cent lines", () => {
    const { orders } = parseSaleRows([row({ Commission: "0", "Frais de port": "0,00" })], MAPPING);
    expect(orders[0].lines[0].fees).toEqual([]);
  });

  it("falls back to the configured default currency", () => {
    const { orders } = parseSaleRows([row({ Devise: "" })], MAPPING, { defaultCurrency: "gbp" });
    expect(orders[0].currency).toBe("GBP");
  });

  it("numbers rows as a human reading the spreadsheet would", () => {
    const { errors } = parseSaleRows(
      [row(), row({ Montant: "oops" })],
      MAPPING,
    );
    // Row 1 of the data is spreadsheet row 2, below the header.
    expect(errors[0].rowNumber).toBe(3);
  });
});

describe("CSV feeds the same mapping core as eBay", () => {
  it("produces provider-namespaced dedupe keys, so re-import converges", () => {
    const { orders } = parseSaleRows([row()], MAPPING);
    const a = mapOrderToUnitWrites(orders[0], { provider: "chrono24", baseCurrency: "EUR", source: "IMPORT" });
    const b = mapOrderToUnitWrites(orders[0], { provider: "chrono24", baseCurrency: "EUR", source: "IMPORT" });

    const keys = a.matched[0].costs.map((c) => c.dedupeKey);
    expect(keys).toEqual(b.matched[0].costs.map((c) => c.dedupeKey));
    expect(keys).toEqual([
      "chrono24:C24-88120:0:marketplace_fee:0",
      "chrono24:C24-88120:0:shipping_out:0",
    ]);
    expect(a.matched[0].costs.every((c) => c.source === "IMPORT")).toBe(true);
  });
});

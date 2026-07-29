import { describe, expect, it } from "vitest";
import { buildUnitWhere, filterUnitRows, sortUnitRows } from "./list";
import type { UnitMargin } from "./margin";
import type { UnitMarginRow } from "./inventory";

// The list module only ever reads `margin`; `unit` is carried through opaquely,
// so the fixtures stub it rather than building a full Prisma payload.
function row(id: string, margin: Partial<UnitMargin>): UnitMarginRow {
  return {
    unit: { id, sku: id } as UnitMarginRow["unit"],
    margin: {
      unitId: id,
      sku: id,
      sold: false,
      revenueCents: 0,
      groups: {
        acquisition: 0,
        restoration: 0,
        logistics: 0,
        fees: 0,
        refunds: 0,
        other: 0,
      },
      totalCostCents: 0,
      vatCents: 0,
      netMarginCents: 0,
      marginPct: null,
      daysHeld: null,
      marginPerDayCents: null,
      cashTiedUpCents: 0,
      ...margin,
    },
  };
}

const TARGET = 25;

describe("buildUnitWhere", () => {
  it("is empty when nothing is filtered", () => {
    expect(buildUnitWhere({})).toEqual({});
  });

  it("uses the isSet:false form for in-stock, never a bare null", () => {
    const where = buildUnitWhere({ dispo: "stock" });
    // Mongo stores no soldAt field until one is written, so `soldAt: null`
    // silently matches nothing — the trap documented in inventory.ts.
    expect(where).toEqual({
      AND: [{ OR: [{ soldAt: null }, { soldAt: { isSet: false } }] }],
    });
  });

  it("matches sold units on a non-null soldAt", () => {
    expect(buildUnitWhere({ dispo: "vendue" })).toEqual({
      AND: [{ soldAt: { not: null } }],
    });
  });

  it("searches the whole catalog identity from the one reference box", () => {
    const where = buildUnitWhere({ ref: "seiko" });
    expect(where).toEqual({
      AND: [
        {
          ref: {
            is: {
              OR: [
                { brand: { contains: "seiko", mode: "insensitive" } },
                { reference: { contains: "seiko", mode: "insensitive" } },
                { model: { contains: "seiko", mode: "insensitive" } },
                { variant: { contains: "seiko", mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  });

  it("matches status and marketplace exactly, text fields loosely", () => {
    const where = buildUnitWhere({
      sku: "wch-00",
      statut: "LISTED",
      canal: "ebay",
      fournisseur: "Dupont",
      serie: "X1",
    });
    expect(where).toEqual({
      AND: [
        { sku: { contains: "wch-00", mode: "insensitive" } },
        { serial: { contains: "X1", mode: "insensitive" } },
        { status: "LISTED" },
        { supplier: { contains: "Dupont", mode: "insensitive" } },
        { soldOn: "ebay" },
      ],
    });
  });

  it("ignores repeated params rather than building a bad clause", () => {
    expect(buildUnitWhere({ sku: ["a", "b"] })).toEqual({});
  });
});

describe("filterUnitRows", () => {
  const rows = [
    row("loss", { sold: true, netMarginCents: -5_000, marginPct: -10 }),
    row("thin", { sold: true, netMarginCents: 2_000, marginPct: 10 }),
    row("atTarget", { sold: true, netMarginCents: 9_000, marginPct: 25 }),
    row("fat", { sold: true, netMarginCents: 30_000, marginPct: 40 }),
    row("stock", { sold: false, daysHeld: 12, cashTiedUpCents: 40_000 }),
  ];

  it("passes everything through when no derived filter is set", () => {
    expect(filterUnitRows(rows, {}, TARGET)).toHaveLength(5);
  });

  it("keeps only loss-making SALES — stock is not a loss", () => {
    const out = filterUnitRows(rows, { marge: "perte" }, TARGET);
    expect(out.map((r) => r.margin.unitId)).toEqual(["loss"]);
  });

  it("treats the target margin as inclusive — exactly at target is not under", () => {
    const out = filterUnitRows(rows, { marge: "sousObjectif" }, TARGET);
    expect(out.map((r) => r.margin.unitId)).toEqual(["loss", "thin"]);
  });

  it("excludes unsold units from the under-target filter", () => {
    // An unsold unit has no margin % yet; counting it as 0 % would flood the
    // list with the whole of stock.
    const out = filterUnitRows(rows, { marge: "sousObjectif" }, TARGET);
    expect(out.some((r) => r.margin.unitId === "stock")).toBe(false);
  });

  it("buckets ageing on stock only, boundary day to the upper bucket", () => {
    const aged = [
      row("d29", { sold: false, daysHeld: 29 }),
      row("d30", { sold: false, daysHeld: 30 }),
      row("d90", { sold: false, daysHeld: 90 }),
      row("soldLong", { sold: true, daysHeld: 200 }),
      row("noDate", { sold: false, daysHeld: null }),
    ];
    const ids = (age: string) =>
      filterUnitRows(aged, { age }, TARGET).map((r) => r.margin.unitId);

    expect(ids("0-30")).toEqual(["d29", "noDate"]);
    expect(ids("30-90")).toEqual(["d30"]);
    expect(ids("90+")).toEqual(["d90"]);
  });
});

describe("sortUnitRows", () => {
  const rows = [
    row("a", { sold: true, netMarginCents: 1_000, marginPerDayCents: 50, daysHeld: 20 }),
    row("b", { sold: false, cashTiedUpCents: 90_000, daysHeld: 200 }),
    row("c", { sold: true, netMarginCents: 9_000, marginPerDayCents: 10, daysHeld: 900 }),
  ];
  const ids = (key: string) => sortUnitRows(rows, key).map((r) => r.margin.unitId);

  it("leaves the Prisma order untouched for the default key", () => {
    expect(ids("")).toEqual(["a", "b", "c"]);
    expect(ids("acquisition")).toEqual(["a", "b", "c"]);
  });

  it("sorts descending on the derived measure", () => {
    expect(ids("marge")).toEqual(["c", "a", "b"]);
    expect(ids("margeJour")).toEqual(["a", "c", "b"]);
    expect(ids("capital")).toEqual(["b", "a", "c"]);
  });

  it("pushes rows with no value for the measure last, not to zero", () => {
    // "b" is unsold: no net margin and no margin/day. Treating those as 0
    // would rank it above the loss-making sales it should sit below.
    const loss = [
      row("sale", { sold: true, netMarginCents: -8_000 }),
      row("stock", { sold: false }),
    ];
    expect(sortUnitRows(loss, "marge").map((r) => r.margin.unitId)).toEqual([
      "sale",
      "stock",
    ]);
  });

  it("is stable when every measure ties or is absent", () => {
    const flat = [row("x", {}), row("y", {}), row("z", {})];
    expect(sortUnitRows(flat, "margePct").map((r) => r.margin.unitId)).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    sortUnitRows(input, "marge");
    expect(input.map((r) => r.margin.unitId)).toEqual(["a", "b", "c"]);
  });

  it("falls back to the input order on an unknown key", () => {
    expect(ids("bogus")).toEqual(["a", "b", "c"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  basePriceCentsOf,
  browseDedupeKey,
  computeBand,
  confidenceFor,
  driftFor,
  inWindow,
  manualDedupeKey,
  ownSaleDedupeKey,
  percentile,
  positionInBand,
  titleMatchesAliases,
  type PricePointInput,
} from "./comps";

const NOW = new Date("2026-07-31T12:00:00Z");

function pt(basePriceCents: number, daysAgo = 0, kind: "SOLD" | "ASK" = "SOLD"): PricePointInput {
  return {
    kind,
    basePriceCents,
    observedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  };
}

describe("percentile", () => {
  it("returns the only value for a single-element array", () => {
    expect(percentile([500], 0.25)).toBe(500);
    expect(percentile([500], 0.5)).toBe(500);
    expect(percentile([500], 0.75)).toBe(500);
  });

  it("interpolates between neighbours rather than snapping to a data point", () => {
    // 4 points, p25 sits at index 0.75 → between 100 and 200.
    expect(percentile([100, 200, 300, 400], 0.25)).toBe(175);
    expect(percentile([100, 200, 300, 400], 0.5)).toBe(250);
    expect(percentile([100, 200, 300, 400], 0.75)).toBe(325);
  });

  it("hits exact endpoints at p0 and p100", () => {
    expect(percentile([10, 20, 30], 0)).toBe(10);
    expect(percentile([10, 20, 30], 1)).toBe(30);
  });

  it("clamps out-of-range percentiles instead of indexing off the end", () => {
    expect(percentile([10, 20, 30], -1)).toBe(10);
    expect(percentile([10, 20, 30], 5)).toBe(30);
  });

  it("throws on an empty array rather than returning a plausible zero", () => {
    expect(() => percentile([], 0.5)).toThrow(/empty/);
  });
});

describe("computeBand", () => {
  it("computes the full band over in-window points", () => {
    const band = computeBand([pt(100), pt(400), pt(200), pt(300)], { kind: "SOLD", now: NOW });
    expect(band).not.toBeNull();
    expect(band!.sampleSize).toBe(4);
    expect(band!.minCents).toBe(100);
    expect(band!.maxCents).toBe(400);
    expect(band!.medianCents).toBe(250);
    expect(band!.p25Cents).toBe(175);
    expect(band!.p75Cents).toBe(325);
  });

  it("returns null — not a zero band — when nothing is in window", () => {
    expect(computeBand([], { kind: "SOLD", now: NOW })).toBeNull();
    expect(computeBand([pt(100, 400)], { kind: "SOLD", now: NOW, windowDays: 180 })).toBeNull();
  });

  it("excludes points older than the window", () => {
    const band = computeBand([pt(100, 10), pt(999, 200)], {
      kind: "SOLD",
      now: NOW,
      windowDays: 180,
    });
    expect(band!.sampleSize).toBe(1);
    expect(band!.maxCents).toBe(100);
  });

  it("THROWS on a mixed-kind array — asks must never dilute a sold band", () => {
    expect(() =>
      computeBand([pt(100, 0, "SOLD"), pt(900, 0, "ASK")], { kind: "SOLD", now: NOW }),
    ).toThrow(/ASK point while computing a SOLD band/);
  });

  it("is unaffected by input ordering", () => {
    const a = computeBand([pt(300), pt(100), pt(200)], { kind: "SOLD", now: NOW });
    const b = computeBand([pt(100), pt(200), pt(300)], { kind: "SOLD", now: NOW });
    expect(a).toEqual(b);
  });
});

describe("inWindow", () => {
  it("keeps a point exactly on the cutoff", () => {
    expect(inWindow([pt(1, 180)], NOW, 180)).toHaveLength(1);
  });

  it("drops a point one day past the cutoff", () => {
    expect(inWindow([pt(1, 181)], NOW, 180)).toHaveLength(0);
  });
});

describe("driftFor", () => {
  it("reports no drift with no previous median", () => {
    expect(driftFor(1000, null, { sampleSize: 20 })).toEqual({
      pct: null,
      drifted: false,
      direction: "flat",
    });
  });

  it("does not divide by a zero baseline", () => {
    expect(driftFor(1000, 0, { sampleSize: 20 }).pct).toBeNull();
  });

  it("flags a move over the threshold with enough sample", () => {
    const r = driftFor(1200, 1000, { sampleSize: 20 });
    expect(r.pct).toBe(20);
    expect(r.drifted).toBe(true);
    expect(r.direction).toBe("up");
  });

  it("REFUSES to flag a big move on a tiny sample", () => {
    const r = driftFor(1400, 1000, { sampleSize: 2 });
    expect(r.pct).toBe(40);
    expect(r.drifted).toBe(false);
  });

  it("flags downward moves too, with a negative pct", () => {
    const r = driftFor(800, 1000, { sampleSize: 20 });
    expect(r.pct).toBe(-20);
    expect(r.drifted).toBe(true);
    expect(r.direction).toBe("down");
  });

  it("treats an exactly-threshold move as drift", () => {
    expect(driftFor(1100, 1000, { sampleSize: 20 }).drifted).toBe(true);
  });

  it("leaves a sub-threshold move alone", () => {
    const r = driftFor(1090, 1000, { sampleSize: 20 });
    expect(r.drifted).toBe(false);
    expect(r.direction).toBe("up");
  });
});

describe("confidenceFor", () => {
  it("grades sample size", () => {
    expect(confidenceFor(0)).toBe("NONE");
    expect(confidenceFor(2)).toBe("LOW");
    expect(confidenceFor(3)).toBe("MEDIUM");
    expect(confidenceFor(9)).toBe("MEDIUM");
    expect(confidenceFor(10)).toBe("HIGH");
  });
});

describe("basePriceCentsOf", () => {
  it("applies the rate and rounds once", () => {
    expect(basePriceCentsOf(10_000, 1.17)).toBe(11_700);
    expect(basePriceCentsOf(3333, 0.923)).toBe(3076);
  });

  it("treats a missing or zero rate as 1:1 rather than zeroing the price", () => {
    expect(basePriceCentsOf(10_000)).toBe(10_000);
    expect(basePriceCentsOf(10_000, 0)).toBe(10_000);
  });
});

describe("positionInBand", () => {
  const band = computeBand([pt(100), pt(200), pt(300), pt(400)], { kind: "SOLD", now: NOW })!;

  it("places a price against the quartiles", () => {
    expect(positionInBand(150, band)).toBe("below"); // < p25 (175)
    expect(positionInBand(250, band)).toBe("within");
    expect(positionInBand(400, band)).toBe("above"); // > p75 (325)
  });

  it("returns null with no band, so the UI can say 'no comparable'", () => {
    expect(positionInBand(250, null)).toBeNull();
  });
});

describe("dedupe keys", () => {
  it("keys an own sale once per unit, whatever the sweep does", () => {
    expect(ownSaleDedupeKey("u1")).toBe("own:u1");
    expect(ownSaleDedupeKey("u1")).toBe(ownSaleDedupeKey("u1"));
  });

  it("keys a browse observation per listing PER DAY", () => {
    const morning = new Date("2026-07-31T08:00:00Z");
    const evening = new Date("2026-07-31T20:00:00Z");
    const tomorrow = new Date("2026-08-01T08:00:00Z");

    expect(browseDedupeKey("ebay", "L1", morning)).toBe(browseDedupeKey("ebay", "L1", evening));
    expect(browseDedupeKey("ebay", "L1", morning)).not.toBe(
      browseDedupeKey("ebay", "L1", tomorrow),
    );
  });

  it("namespaces by provider so two marketplaces cannot collide", () => {
    const d = new Date("2026-07-31T08:00:00Z");
    expect(browseDedupeKey("ebay", "1", d)).not.toBe(browseDedupeKey("chrono24", "1", d));
  });

  it("keeps manual comps in their own namespace", () => {
    expect(manualDedupeKey("abc")).toBe("manual:abc");
    expect(manualDedupeKey("abc")).not.toBe(ownSaleDedupeKey("abc"));
  });
});

describe("titleMatchesAliases", () => {
  it("matches case-insensitively on a declared alias", () => {
    expect(titleMatchesAliases("Seiko SKX007 Diver Automatic", ["skx007"])).toBe(true);
    expect(titleMatchesAliases("seiko skx007", ["SKX007"])).toBe(true);
  });

  it("does NOT match on brand alone — that would poison the band", () => {
    expect(titleMatchesAliases("Seiko 5 Sports SNK809", ["skx007"])).toBe(false);
  });

  it("returns false when the ref declares no aliases", () => {
    expect(titleMatchesAliases("Seiko SKX007", [])).toBe(false);
  });

  it("ignores blank aliases rather than matching everything", () => {
    expect(titleMatchesAliases("anything at all", ["", "   "])).toBe(false);
  });
});

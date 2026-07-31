import { describe, expect, it } from "vitest";
import {
  effectiveRateCents,
  formatDuration,
  labourCostCents,
  parseDuration,
  summariseLabour,
  workLogDedupeKey,
} from "./labour";

describe("labourCostCents", () => {
  it("prices a whole hour at the rate", () => {
    expect(labourCostCents(60, 3_500)).toBe(3_500);
  });

  it("prices a part hour proportionally", () => {
    expect(labourCostCents(30, 3_500)).toBe(1_750);
    expect(labourCostCents(90, 3_500)).toBe(5_250);
  });

  it("rounds ONCE at the end, not per minute", () => {
    // 7 min at 3500/h = 408.33 cents. Per-minute rounding would give 7×58=406.
    expect(labourCostCents(7, 3_500)).toBe(408);
  });

  it("returns 0 for non-positive or non-finite inputs rather than NaN", () => {
    expect(labourCostCents(0, 3_500)).toBe(0);
    expect(labourCostCents(-30, 3_500)).toBe(0);
    expect(labourCostCents(60, 0)).toBe(0);
    expect(labourCostCents(60, -100)).toBe(0);
    expect(labourCostCents(Number.NaN, 3_500)).toBe(0);
  });
});

describe("effectiveRateCents", () => {
  it("prefers the person's own rate", () => {
    expect(effectiveRateCents(5_000, 3_500)).toBe(5_000);
  });

  it("falls back to the house rate when absent, null or zero", () => {
    expect(effectiveRateCents(undefined, 3_500)).toBe(3_500);
    expect(effectiveRateCents(null, 3_500)).toBe(3_500);
    expect(effectiveRateCents(0, 3_500)).toBe(3_500);
  });

  it("never returns a negative rate", () => {
    expect(effectiveRateCents(null, -100)).toBe(0);
  });
});

describe("parseDuration", () => {
  it("parses bare minutes", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("90m")).toBe(90);
  });

  it("parses hour forms", () => {
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1h30")).toBe(90);
    expect(parseDuration("1h 30")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("1,5h")).toBe(90);
  });

  it("rejects nonsense rather than guessing", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("-30")).toBeNull();
    // 90 minutes past the hour is a typo, not 2h30.
    expect(parseDuration("1h90")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats minutes, hours and both", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(90)).toBe("1 h 30");
    expect(formatDuration(65)).toBe("1 h 05");
  });

  it("handles zero and negatives", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(-5)).toBe("0 min");
  });
});

describe("workLogDedupeKey", () => {
  it("is stable and namespaced away from other cost sources", () => {
    expect(workLogDedupeKey("abc")).toBe("work:abc");
    expect(workLogDedupeKey("abc")).not.toBe("partlot:abc");
  });
});

describe("summariseLabour", () => {
  it("rolls up per person, highest cost first", () => {
    const s = summariseLabour([
      { personId: "p1", personName: "Ana", minutes: 60, costCents: 3_500 },
      { personId: "p2", personName: "Ben", minutes: 120, costCents: 8_000 },
      { personId: "p1", personName: "Ana", minutes: 30, costCents: 1_750 },
    ]);
    expect(s.totalMinutes).toBe(210);
    expect(s.totalCostCents).toBe(13_250);
    expect(s.byPerson.map((p) => p.name)).toEqual(["Ben", "Ana"]);
    expect(s.byPerson[1]).toMatchObject({ minutes: 90, costCents: 5_250 });
  });

  it("returns empty totals for no logs", () => {
    expect(summariseLabour([])).toEqual({ totalMinutes: 0, totalCostCents: 0, byPerson: [] });
  });
});

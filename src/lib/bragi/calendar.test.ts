import { describe, expect, it } from "vitest";
import { isoWeekday, isSlotDue, periodKeyFor } from "./calendar";

describe("isoWeekday", () => {
  it("maps Monday to 1 and Sunday to 7", () => {
    expect(isoWeekday(new Date(2026, 6, 13))).toBe(1); // Mon 2026-07-13
    expect(isoWeekday(new Date(2026, 6, 19))).toBe(7); // Sun 2026-07-19
  });
});

describe("periodKeyFor — weekly (ISO week)", () => {
  it("computes a mid-year week", () => {
    expect(periodKeyFor("weekly", new Date(2026, 6, 19))).toBe("2026-W29");
  });

  it("zero-pads single-digit weeks", () => {
    // Thu 2026-01-01 is ISO week 1 of 2026.
    expect(periodKeyFor("weekly", new Date(2026, 0, 1))).toBe("2026-W01");
  });

  it("assigns early January to the prior ISO year's week 53", () => {
    // Fri 2027-01-01 belongs to ISO 2026-W53 (2026-01-01 is a Thursday).
    expect(periodKeyFor("weekly", new Date(2027, 0, 1))).toBe("2026-W53");
  });

  it("assigns late December to the next ISO year's week 1", () => {
    // Mon 2024-12-30 belongs to ISO 2025-W01.
    expect(periodKeyFor("weekly", new Date(2024, 11, 30))).toBe("2025-W01");
  });
});

describe("periodKeyFor — monthly", () => {
  it("uses calendar year-month, zero-padded", () => {
    expect(periodKeyFor("monthly", new Date(2026, 6, 19))).toBe("2026-07");
    expect(periodKeyFor("monthly", new Date(2026, 0, 3))).toBe("2026-01");
  });
});

const weeklySlot = {
  active: true,
  cadence: "weekly",
  weekday: 2, // Tuesday
  dayOfMonth: null,
  lastGeneratedPeriod: null,
};

const monthlySlot = {
  active: true,
  cadence: "monthly",
  weekday: null,
  dayOfMonth: 1,
  lastGeneratedPeriod: null,
};

const tue = new Date(2026, 6, 14); // Tue 2026-07-14, ISO 2026-W29
const wed = new Date(2026, 6, 15);

describe("isSlotDue — weekly", () => {
  it("is due on the slot's weekday when never generated", () => {
    expect(isSlotDue(weeklySlot, tue)).toBe(true);
  });

  it("is not due on any other weekday", () => {
    expect(isSlotDue(weeklySlot, wed)).toBe(false);
  });

  it("is not due when inactive", () => {
    expect(isSlotDue({ ...weeklySlot, active: false }, tue)).toBe(false);
  });

  it("is not due when the current period was already generated", () => {
    expect(isSlotDue({ ...weeklySlot, lastGeneratedPeriod: "2026-W29" }, tue)).toBe(false);
  });

  it("is due again when the last generation was a prior period", () => {
    expect(isSlotDue({ ...weeklySlot, lastGeneratedPeriod: "2026-W28" }, tue)).toBe(true);
  });

  it("is never due without a weekday", () => {
    expect(isSlotDue({ ...weeklySlot, weekday: null }, tue)).toBe(false);
  });
});

describe("isSlotDue — monthly", () => {
  it("is due on the slot's day of month when never generated", () => {
    expect(isSlotDue(monthlySlot, new Date(2026, 6, 1))).toBe(true);
  });

  it("is not due on any other day", () => {
    expect(isSlotDue(monthlySlot, new Date(2026, 6, 2))).toBe(false);
  });

  it("is not due when the current month was already generated", () => {
    expect(
      isSlotDue({ ...monthlySlot, lastGeneratedPeriod: "2026-07" }, new Date(2026, 6, 1)),
    ).toBe(false);
  });

  it("is due again the next month", () => {
    expect(
      isSlotDue({ ...monthlySlot, lastGeneratedPeriod: "2026-06" }, new Date(2026, 6, 1)),
    ).toBe(true);
  });

  it("is never due without a dayOfMonth", () => {
    expect(isSlotDue({ ...monthlySlot, dayOfMonth: null }, new Date(2026, 6, 1))).toBe(false);
  });
});

describe("isSlotDue — unknown cadence", () => {
  it("is never due", () => {
    expect(isSlotDue({ ...weeklySlot, cadence: "daily" }, tue)).toBe(false);
  });
});

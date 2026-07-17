import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  assertTransition,
  isAutoApproveEligible,
  isExpired,
  isUndoable,
  type ActionStatus,
} from "./state-machine";

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS) as ActionStatus[];

describe("assertTransition", () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALLOWED_TRANSITIONS[from]) {
      it(`allows ${from} -> ${to}`, () => {
        expect(() => assertTransition(from, to)).not.toThrow();
      });
    }
  }

  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (ALLOWED_TRANSITIONS[from].includes(to)) continue;
      it(`rejects ${from} -> ${to}`, () => {
        expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
      });
    }
  }
});

describe("isAutoApproveEligible", () => {
  it.each([
    [0, false, false, false],
    [1, false, false, false],
    [2, false, false, true],
    [3, false, false, true],
    [2, true, false, false], // paused category blocks auto-approval
    [3, true, false, false],
    [2, false, true, false], // health-flagged content blocks it regardless of level
    [3, false, true, false],
  ])("level=%i paused=%s healthFlagged=%s -> %s", (level, paused, healthFlagged, expected) => {
    expect(isAutoApproveEligible(level, paused, healthFlagged)).toBe(expected);
  });
});

describe("isUndoable", () => {
  const executedAt = new Date("2026-07-17T12:00:00Z");
  const undoWindowMinutes = 60;

  it("is undoable just inside the window", () => {
    const now = new Date("2026-07-17T12:59:00Z");
    expect(isUndoable(true, executedAt, undoWindowMinutes, now)).toBe(true);
  });

  it("is undoable exactly at the window edge", () => {
    const now = new Date("2026-07-17T13:00:00Z");
    expect(isUndoable(true, executedAt, undoWindowMinutes, now)).toBe(true);
  });

  it("is not undoable just outside the window", () => {
    const now = new Date("2026-07-17T13:00:01Z");
    expect(isUndoable(true, executedAt, undoWindowMinutes, now)).toBe(false);
  });

  it("is not undoable when not reversible", () => {
    const now = new Date("2026-07-17T12:30:00Z");
    expect(isUndoable(false, executedAt, undoWindowMinutes, now)).toBe(false);
  });

  it("is not undoable when never executed", () => {
    const now = new Date("2026-07-17T12:30:00Z");
    expect(isUndoable(true, null, undoWindowMinutes, now)).toBe(false);
  });
});

describe("isExpired", () => {
  const now = new Date("2026-07-17T12:00:00Z");

  it("is expired when expiresAt is in the past", () => {
    expect(isExpired(new Date("2026-07-17T11:00:00Z"), now)).toBe(true);
  });

  it("is not expired when expiresAt is in the future", () => {
    expect(isExpired(new Date("2026-07-17T13:00:00Z"), now)).toBe(false);
  });

  it("is not expired when expiresAt is null", () => {
    expect(isExpired(null, now)).toBe(false);
  });
});

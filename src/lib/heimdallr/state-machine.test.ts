import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  assertTransition,
  breakerDecision,
  graduationDecision,
  isAutoApproveEligible,
  isExpired,
  isGraduationEligible,
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

describe("breakerDecision", () => {
  const thresholds = { editRateThresholdPct: 20, negativeSignalThresholdPct: 5, breakerMinSample: 10 };

  it("does not trip below the sample floor, even at a high rate", () => {
    const decision = breakerDecision({ editRate: { sample: 5, count: 5 }, ...thresholds });
    expect(decision).toEqual({ trip: false, reason: null, editRatePct: null, negativeSignalPct: null });
  });

  it("trips on edit-rate over threshold", () => {
    const decision = breakerDecision({ editRate: { sample: 20, count: 5 }, ...thresholds });
    expect(decision.trip).toBe(true);
    expect(decision.reason).toBe("edit_rate");
    expect(decision.editRatePct).toBe(25);
  });

  it("trips on edit-rate exactly at threshold (>=)", () => {
    const decision = breakerDecision({ editRate: { sample: 100, count: 20 }, ...thresholds });
    expect(decision.trip).toBe(true);
    expect(decision.reason).toBe("edit_rate");
  });

  it("does not trip when edit-rate is under threshold", () => {
    const decision = breakerDecision({ editRate: { sample: 100, count: 10 }, ...thresholds });
    expect(decision.trip).toBe(false);
    expect(decision.editRatePct).toBe(10);
  });

  it("trips on negative-signal over threshold when edit-rate is fine", () => {
    const decision = breakerDecision({
      editRate: { sample: 100, count: 5 },
      negativeSignal: { sample: 20, count: 2 },
      ...thresholds,
    });
    expect(decision.trip).toBe(true);
    expect(decision.reason).toBe("negative_signal");
    expect(decision.negativeSignalPct).toBe(10);
  });

  it("ignores negative-signal under its own sample floor", () => {
    const decision = breakerDecision({
      editRate: { sample: 100, count: 5 },
      negativeSignal: { sample: 3, count: 3 },
      ...thresholds,
    });
    expect(decision.trip).toBe(false);
    expect(decision.negativeSignalPct).toBeNull();
  });

  it("prefers edit-rate as the reported reason when both trip", () => {
    const decision = breakerDecision({
      editRate: { sample: 100, count: 30 },
      negativeSignal: { sample: 20, count: 5 },
      ...thresholds,
    });
    expect(decision.trip).toBe(true);
    expect(decision.reason).toBe("edit_rate");
  });

  it("does not trip when both signals are under threshold", () => {
    const decision = breakerDecision({
      editRate: { sample: 100, count: 5 },
      negativeSignal: { sample: 20, count: 0 },
      ...thresholds,
    });
    expect(decision.trip).toBe(false);
    expect(decision.reason).toBeNull();
  });
});

describe("graduationDecision", () => {
  const thresholds = { graduationUneditedPct: 95, breakerMinSample: 10 };

  it("does not graduate below the sample floor, even at a perfect rate", () => {
    const decision = graduationDecision({ unedited: { sample: 5, count: 5 }, ...thresholds });
    expect(decision).toEqual({ graduate: false, uneditedPct: null });
  });

  it("graduates when unedited-rate is over threshold", () => {
    const decision = graduationDecision({ unedited: { sample: 20, count: 19 }, ...thresholds });
    expect(decision.graduate).toBe(true);
    expect(decision.uneditedPct).toBe(95);
  });

  it("graduates exactly at threshold (>=)", () => {
    const decision = graduationDecision({ unedited: { sample: 100, count: 95 }, ...thresholds });
    expect(decision.graduate).toBe(true);
  });

  it("does not graduate when unedited-rate is under threshold", () => {
    const decision = graduationDecision({ unedited: { sample: 100, count: 90 }, ...thresholds });
    expect(decision.graduate).toBe(false);
    expect(decision.uneditedPct).toBe(90);
  });
});

describe("isGraduationEligible", () => {
  it.each([
    [0, 3, false], // level 0 (off) never graduates directly to 2
    [1, 3, true],
    [1, 1, false], // maxLevel 1 — never-graduates floor (finance/legal)
    [2, 3, false], // already past the 1 -> 2 graduation step
    [3, 3, false],
  ])("level=%i maxLevel=%i -> %s", (level, maxLevel, expected) => {
    expect(isGraduationEligible(level, maxLevel)).toBe(expected);
  });
});

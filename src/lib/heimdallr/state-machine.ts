// Pure guard logic for the AgentAction lifecycle (docs/mimir/events.md §2). No
// I/O here on purpose — ledger.ts is the only caller, and this file is what S7
// unit-tests directly. Keep it that way: any DB/Date.now() dependency belongs
// in ledger.ts, not here.

export type ActionStatus =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "EXECUTED"
  | "FAILED"
  | "UNDONE";

// events.md §2 guard table, verbatim. Anything not listed here is terminal.
export const ALLOWED_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  PROPOSED: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["EXECUTED", "FAILED"],
  EXECUTED: ["UNDONE"],
  REJECTED: [],
  EXPIRED: [],
  FAILED: [],
  UNDONE: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: ActionStatus, to: ActionStatus) {
    super(`AgentAction: ${from} -> ${to} is not a legal transition`);
    this.name = "InvalidTransitionError";
  }
}

/** Throws InvalidTransitionError unless `from -> to` is in the guard table. */
export function assertTransition(from: ActionStatus, to: ActionStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

/**
 * D2/D3 auto-approval guard: level >= 2 (auto_with_undo or autonomous), the
 * category isn't paused (kill switch), and nothing flagged this content.
 * `healthFlagged` is a plain boolean — S11 (health classifier) doesn't exist
 * yet, but the floor is coded now so no tenant config can ever lift it later.
 */
export function isAutoApproveEligible(
  level: number,
  categoryPaused: boolean,
  healthFlagged: boolean,
): boolean {
  return level >= 2 && !categoryPaused && !healthFlagged;
}

/**
 * An EXECUTED action can be UNDONE only if it was marked reversible, it has
 * actually executed, and the undo window (AutonomyConfig.undoWindowMinutes)
 * hasn't elapsed yet.
 */
export function isUndoable(
  reversible: boolean,
  executedAt: Date | null,
  undoWindowMinutes: number,
  now: Date,
): boolean {
  if (!reversible || !executedAt) return false;
  const elapsedMinutes = (now.getTime() - executedAt.getTime()) / 60_000;
  return elapsedMinutes <= undoWindowMinutes;
}

/** A PROPOSED action is sweepable once its expiresAt has passed. */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() < now.getTime();
}

/** A trailing-window count pair for the circuit breaker (edit-rate or negative-signal). */
export type BreakerSignal = { sample: number; count: number };

export type BreakerDecision = {
  trip: boolean;
  reason: "edit_rate" | "negative_signal" | null;
  editRatePct: number | null;
  negativeSignalPct: number | null;
};

/**
 * Per-category circuit breaker (S9), generalizing the inherited outreach
 * bounce-breaker (lib/outreach/guardrails.ts bounceBreakerReason) from a
 * tenant-wide pause to a per-category demotion. Each signal is independently
 * gated by breakerMinSample — below sample, its rate is noise and stays null,
 * same as bounceBreakerReason returning null under BREAKER_MIN_SAMPLE.
 * negativeSignal is module-supplied and optional: no module produces one yet
 * (Huginn doesn't exist until Phase 2), so edit-rate alone can trip today.
 */
export function breakerDecision(input: {
  editRate: BreakerSignal;
  negativeSignal?: BreakerSignal;
  editRateThresholdPct: number;
  negativeSignalThresholdPct: number;
  breakerMinSample: number;
}): BreakerDecision {
  const { editRate, negativeSignal, editRateThresholdPct, negativeSignalThresholdPct, breakerMinSample } =
    input;

  const editRatePct =
    editRate.sample >= breakerMinSample ? (editRate.count / editRate.sample) * 100 : null;
  const negativeSignalPct =
    negativeSignal && negativeSignal.sample >= breakerMinSample
      ? (negativeSignal.count / negativeSignal.sample) * 100
      : null;

  if (editRatePct !== null && editRatePct >= editRateThresholdPct) {
    return { trip: true, reason: "edit_rate", editRatePct, negativeSignalPct };
  }
  if (negativeSignalPct !== null && negativeSignalPct >= negativeSignalThresholdPct) {
    return { trip: true, reason: "negative_signal", editRatePct, negativeSignalPct };
  }
  return { trip: false, reason: null, editRatePct, negativeSignalPct };
}

/** A trailing-window unedited/sample pair for graduation math — same shape as BreakerSignal. */
export type GraduationDecision = { graduate: boolean; uneditedPct: number | null };

/**
 * Per-category graduation check (S15), the promotion counterpart to breakerDecision's
 * demotion. events.md "Graduation-math inputs": unedited-rate over the trailing window,
 * gated by the same breakerMinSample floor so a thin sample stays silent (null) rather
 * than graduating on noise.
 */
export function graduationDecision(input: {
  unedited: BreakerSignal; // { sample, count } — count = unedited actions in window
  graduationUneditedPct: number;
  breakerMinSample: number;
}): GraduationDecision {
  const { unedited, graduationUneditedPct, breakerMinSample } = input;
  const uneditedPct =
    unedited.sample >= breakerMinSample ? (unedited.count / unedited.sample) * 100 : null;
  return { graduate: uneditedPct !== null && uneditedPct >= graduationUneditedPct, uneditedPct };
}

/**
 * Never-graduates floor (events.md "Never-graduates enforcement" #1): a category can only
 * earn level 2 from level 1, and only if its configured ceiling (money/legal ship at
 * maxLevel: 1) allows it.
 */
export function isGraduationEligible(level: number, maxLevel: number): boolean {
  return level === 1 && maxLevel >= 2;
}

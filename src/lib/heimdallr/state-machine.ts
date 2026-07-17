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

import type { AgentAction, AutonomyConfig, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getUneditedStats } from "./queries";
import {
  assertTransition,
  breakerDecision,
  graduationDecision,
  isAutoApproveEligible,
  isExpired,
  isGraduationEligible,
  isUndoable,
  type ActionStatus,
  type BreakerSignal,
} from "./state-machine";

// The Heimdallr write API (D5): the only code path allowed to move an
// AgentAction between states. Every transition below is one Prisma
// interactive transaction — read current state, guard it, apply the update,
// write the paired AgentEvent — so the ledger (current state) and the event
// stream (history) can never drift (docs/mimir/events.md §1/§2).
//
// Every function takes the tenant PrismaClient as its first argument, same
// convention as lib/ai/meter.ts / lib/outreach/guardrails.ts — never import
// getTenantDb() here, so this stays callable from session-less contexts
// (Inngest jobs, per the S4 standing rule in decisions.md).

const proposeActionInput = z.object({
  module: z.string().min(1),
  category: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown(),
  sources: z.unknown().optional(),
  trigger: z.unknown().optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  autonomyLevelAtProposal: z.number().int().min(0).max(3),
  promptKey: z.string().optional(),
  promptVersion: z.number().int().optional(),
  reversible: z.boolean().optional().default(false),
  expiresAt: z.date().optional(),
});
export type ProposeActionInput = z.input<typeof proposeActionInput>;

const approveActionInput = z.object({
  decidedBy: z.string().optional(),
  editedPayload: z.unknown().optional(),
});
export type ApproveActionInput = z.input<typeof approveActionInput>;

const executeActionInput = z.object({
  undoData: z.unknown().optional(),
});
export type ExecuteActionInput = z.input<typeof executeActionInput>;

/** Create a PROPOSED AgentAction and emit its `proposed` AgentEvent. */
export async function proposeAction(
  prisma: PrismaClient,
  input: ProposeActionInput,
): Promise<AgentAction> {
  const data = proposeActionInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const action = await tx.agentAction.create({
      data: {
        module: data.module,
        category: data.category,
        type: data.type,
        payload: data.payload as Prisma.InputJsonValue,
        sources: data.sources as Prisma.InputJsonValue | undefined,
        trigger: data.trigger as Prisma.InputJsonValue | undefined,
        entity: data.entity,
        entityId: data.entityId,
        autonomyLevelAtProposal: data.autonomyLevelAtProposal,
        promptKey: data.promptKey,
        promptVersion: data.promptVersion,
        reversible: data.reversible,
        expiresAt: data.expiresAt,
      },
    });
    await tx.agentEvent.create({
      data: {
        module: data.module,
        category: data.category,
        action: "proposed",
        actionId: action.id,
        entity: data.entity,
        entityId: data.entityId,
      },
    });
    return action;
  });
}

/**
 * PROPOSED -> APPROVED. `decidedBy` omitted means auto-approval (level >= 2) —
 * the `approved` event records `data: { auto: true }` in that case. A supplied
 * `editedPayload` marks the action edited and emits `edited` alongside
 * `approved`, per events.md §1.
 */
export async function approveAction(
  prisma: PrismaClient,
  id: string,
  input: ApproveActionInput = {},
): Promise<AgentAction> {
  const { decidedBy, editedPayload } = approveActionInput.parse(input);
  const wasEdited = editedPayload !== undefined;
  return prisma.$transaction(async (tx) => {
    const current = await tx.agentAction.findUniqueOrThrow({ where: { id } });
    assertTransition(current.status as ActionStatus, "APPROVED");
    const now = new Date();
    const action = await tx.agentAction.update({
      where: { id },
      data: {
        status: "APPROVED",
        decidedAt: now,
        decidedBy,
        editedPayload: editedPayload as Prisma.InputJsonValue | undefined,
        wasEdited,
      },
    });
    await tx.agentEvent.create({
      data: {
        module: action.module,
        category: action.category,
        action: "approved",
        actionId: action.id,
        entity: action.entity,
        entityId: action.entityId,
        userId: decidedBy,
        data: { auto: decidedBy == null },
      },
    });
    if (wasEdited) {
      await tx.agentEvent.create({
        data: {
          module: action.module,
          category: action.category,
          action: "edited",
          actionId: action.id,
          entity: action.entity,
          entityId: action.entityId,
          userId: decidedBy,
        },
      });
    }
    return action;
  });
}

/** PROPOSED -> REJECTED. Human decision only — no auto-reject path exists. */
export async function rejectAction(
  prisma: PrismaClient,
  id: string,
  decidedBy: string,
): Promise<AgentAction> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.agentAction.findUniqueOrThrow({ where: { id } });
    assertTransition(current.status as ActionStatus, "REJECTED");
    const action = await tx.agentAction.update({
      where: { id },
      data: { status: "REJECTED", decidedAt: new Date(), decidedBy },
    });
    await tx.agentEvent.create({
      data: {
        module: action.module,
        category: action.category,
        action: "rejected",
        actionId: action.id,
        entity: action.entity,
        entityId: action.entityId,
        userId: decidedBy,
      },
    });
    return action;
  });
}

/** PROPOSED -> EXPIRED. Sweep-job only; guarded by expiresAt < now. */
export async function expireAction(
  prisma: PrismaClient,
  id: string,
  now: Date = new Date(),
): Promise<AgentAction> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.agentAction.findUniqueOrThrow({ where: { id } });
    assertTransition(current.status as ActionStatus, "EXPIRED");
    if (!isExpired(current.expiresAt, now)) {
      throw new Error(`AgentAction ${id}: expiresAt has not passed`);
    }
    const action = await tx.agentAction.update({
      where: { id },
      data: { status: "EXPIRED", decidedAt: now },
    });
    await tx.agentEvent.create({
      data: {
        module: action.module,
        category: action.category,
        action: "expired",
        actionId: action.id,
        entity: action.entity,
        entityId: action.entityId,
      },
    });
    return action;
  });
}

/** Expire every PROPOSED row whose expiresAt has passed. Returns the count. */
export async function sweepExpired(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const stale = await prisma.agentAction.findMany({
    where: { status: "PROPOSED", expiresAt: { lt: now } },
    select: { id: true },
  });
  for (const { id } of stale) {
    await expireAction(prisma, id, now);
  }
  return stale.length;
}

/**
 * APPROVED -> EXECUTED. A reversible action must record `undoData` — there's
 * no later chance to capture how to undo it.
 */
export async function executeAction(
  prisma: PrismaClient,
  id: string,
  input: ExecuteActionInput = {},
): Promise<AgentAction> {
  const { undoData } = executeActionInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const current = await tx.agentAction.findUniqueOrThrow({ where: { id } });
    assertTransition(current.status as ActionStatus, "EXECUTED");
    if (current.reversible && undoData === undefined) {
      throw new Error(
        `AgentAction ${id}: reversible actions must supply undoData on execution`,
      );
    }
    const action = await tx.agentAction.update({
      where: { id },
      data: {
        status: "EXECUTED",
        executedAt: new Date(),
        undoData: undoData as Prisma.InputJsonValue | undefined,
      },
    });
    await tx.agentEvent.create({
      data: {
        module: action.module,
        category: action.category,
        action: "executed",
        actionId: action.id,
        entity: action.entity,
        entityId: action.entityId,
      },
    });
    return action;
  });
}

/** APPROVED -> FAILED. Terminal — a retry is a fresh PROPOSED row. */
export async function failAction(
  prisma: PrismaClient,
  id: string,
  error: string,
): Promise<AgentAction> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.agentAction.findUniqueOrThrow({ where: { id } });
    assertTransition(current.status as ActionStatus, "FAILED");
    const action = await tx.agentAction.update({
      where: { id },
      data: { status: "FAILED", error },
    });
    await tx.agentEvent.create({
      data: {
        module: action.module,
        category: action.category,
        action: "failed",
        actionId: action.id,
        entity: action.entity,
        entityId: action.entityId,
        data: { error },
      },
    });
    return action;
  });
}

/** EXECUTED -> UNDONE, guarded by the undo window. */
export async function undoAction(
  prisma: PrismaClient,
  id: string,
  undoWindowMinutes: number,
): Promise<AgentAction> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.agentAction.findUniqueOrThrow({ where: { id } });
    assertTransition(current.status as ActionStatus, "UNDONE");
    const now = new Date();
    if (!isUndoable(current.reversible, current.executedAt, undoWindowMinutes, now)) {
      throw new Error(`AgentAction ${id}: outside the undo window or not reversible`);
    }
    const action = await tx.agentAction.update({
      where: { id },
      data: { status: "UNDONE", undoneAt: now },
    });
    await tx.agentEvent.create({
      data: {
        module: action.module,
        category: action.category,
        action: "undone",
        actionId: action.id,
        entity: action.entity,
        entityId: action.entityId,
      },
    });
    return action;
  });
}

/**
 * Convenience wrapper around the D2/D3 auto-approval guard: approves (with
 * `decidedBy` left unset) iff `isAutoApproveEligible`. Returns null when not
 * eligible so callers can fall back to leaving the action PROPOSED.
 */
export async function autoApproveIfEligible(
  prisma: PrismaClient,
  id: string,
  opts: { level: number; categoryPaused: boolean; healthFlagged?: boolean },
): Promise<AgentAction | null> {
  if (!isAutoApproveEligible(opts.level, opts.categoryPaused, opts.healthFlagged ?? false)) {
    return null;
  }
  return approveAction(prisma, id, {});
}

/**
 * Demote a category to level 1 (draft_approve) when the breaker trips.
 * No-op (returns null) if the category doesn't exist or is already <= 1 —
 * there's nothing to demote. Writes both events.md §3 verbs: `breaker_tripped`
 * (the rate numbers that caused it) and `level_changed` (the level move
 * itself), in one transaction so ledger and event stream can't drift.
 */
export async function demoteCategory(
  prisma: PrismaClient,
  category: string,
  reason: string,
  data: { editRatePct: number | null; negativeSignalPct: number | null },
): Promise<AutonomyConfig | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.autonomyConfig.findUnique({ where: { category } });
    if (!current || current.level <= 1) return null;
    const now = new Date();
    const config = await tx.autonomyConfig.update({
      where: { category },
      data: { level: 1, lastBreakerTrippedAt: now, lastBreakerReason: reason },
    });
    await tx.agentEvent.create({
      data: {
        module: "system",
        category,
        action: "breaker_tripped",
        data: { ...data, from: current.level, to: 1, reason },
      },
    });
    await tx.agentEvent.create({
      data: {
        module: "system",
        category,
        action: "level_changed",
        data: { from: current.level, to: 1, cause: "breaker" },
      },
    });
    return config;
  });
}

/**
 * Check one category's trailing edit-rate (AgentAction.wasEdited over
 * graduationWindowDays) — and an optional module-supplied negative-signal —
 * against its AutonomyConfig thresholds, demoting on trip. No-op if the
 * category isn't level >= 2 (already not auto-approving, nothing to trip).
 * Returns the computed decision either way, tripped or not.
 */
export async function evaluateBreaker(
  prisma: PrismaClient,
  category: string,
  now: Date = new Date(),
  negativeSignal?: BreakerSignal,
): Promise<ReturnType<typeof breakerDecision> | null> {
  const config = await prisma.autonomyConfig.findUnique({ where: { category } });
  if (!config || config.level < 2) return null;

  const since = new Date(now.getTime() - config.graduationWindowDays * 86_400_000);
  const [sample, count] = await Promise.all([
    prisma.agentAction.count({ where: { category, decidedAt: { gte: since } } }),
    prisma.agentAction.count({
      where: { category, decidedAt: { gte: since }, wasEdited: true },
    }),
  ]);

  const decision = breakerDecision({
    editRate: { sample, count },
    negativeSignal,
    editRateThresholdPct: config.editRateThresholdPct,
    negativeSignalThresholdPct: config.negativeSignalThresholdPct,
    breakerMinSample: config.breakerMinSample,
  });

  if (decision.trip) {
    await demoteCategory(prisma, category, decision.reason!, {
      editRatePct: decision.editRatePct,
      negativeSignalPct: decision.negativeSignalPct,
    });
  }
  return decision;
}

/**
 * Sweep every level>=2 category through evaluateBreaker. Same shape as
 * sweepExpired — exported for a future cron wire-up, not called from one yet
 * (no Inngest cron infra exists for either sweep today).
 */
export async function sweepBreachedCategories(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const categories = await prisma.autonomyConfig.findMany({
    where: { level: { gte: 2 } },
    select: { category: true },
  });
  let demoted = 0;
  for (const { category } of categories) {
    const decision = await evaluateBreaker(prisma, category, now);
    if (decision?.trip) demoted += 1;
  }
  return demoted;
}

/**
 * Promote a category 1 -> 2 (draft_approve -> auto_with_undo). No-op (returns null)
 * if the category doesn't exist or isn't graduation-eligible (isGraduationEligible) —
 * money/legal's maxLevel: 1 floor makes this permanently a no-op for them. Writes a
 * single `level_changed` event, cause "graduation" — unlike the breaker there's no
 * separate diagnostic verb reserved for graduation, so the rate numbers that earned
 * it live in this event's data (events.md §1/§3).
 */
export async function promoteCategory(
  prisma: PrismaClient,
  category: string,
  data: { uneditedPct: number | null; sample: number },
): Promise<AutonomyConfig | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.autonomyConfig.findUnique({ where: { category } });
    if (!current || !isGraduationEligible(current.level, current.maxLevel)) return null;
    const config = await tx.autonomyConfig.update({
      where: { category },
      data: { level: 2 },
    });
    await tx.agentEvent.create({
      data: {
        module: "system",
        category,
        action: "level_changed",
        data: { from: current.level, to: 2, cause: "graduation", ...data },
      },
    });
    return config;
  });
}

/**
 * Check one category's trailing unedited-rate (AgentAction.wasEdited over
 * graduationWindowDays, events.md eligible set) against its AutonomyConfig
 * thresholds, promoting on graduate. No-op (returns null) if the category isn't
 * graduation-eligible (level != 1 or maxLevel < 2 — the never-graduates floor).
 * Returns the computed decision either way, graduated or not.
 */
export async function evaluateGraduation(
  prisma: PrismaClient,
  category: string,
  now: Date = new Date(),
): Promise<(ReturnType<typeof graduationDecision> & { sample: number }) | null> {
  const config = await prisma.autonomyConfig.findUnique({ where: { category } });
  if (!config || !isGraduationEligible(config.level, config.maxLevel)) return null;

  const { sample, count } = await getUneditedStats(prisma, category, config.graduationWindowDays, now);

  const decision = graduationDecision({
    unedited: { sample, count },
    graduationUneditedPct: config.graduationUneditedPct,
    breakerMinSample: config.breakerMinSample,
  });

  if (decision.graduate) {
    await promoteCategory(prisma, category, { uneditedPct: decision.uneditedPct, sample });
  }
  return { ...decision, sample };
}

/**
 * Sweep every graduation-eligible category (level 1, maxLevel >= 2) through
 * evaluateGraduation. Same shape as sweepBreachedCategories — exported for a
 * future cron wire-up, not called from one yet (no Inngest cron infra exists
 * for any sweep today; run manually via scripts/heimdallr/run-graduation-sweep.ts).
 */
export async function sweepGraduationEligible(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const categories = await prisma.autonomyConfig.findMany({
    where: { level: 1, maxLevel: { gte: 2 } },
    select: { category: true },
  });
  let graduated = 0;
  for (const { category } of categories) {
    const decision = await evaluateGraduation(prisma, category, now);
    if (decision?.graduate) graduated += 1;
  }
  return graduated;
}

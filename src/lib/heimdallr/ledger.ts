import type { AgentAction, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  assertTransition,
  isAutoApproveEligible,
  isExpired,
  isUndoable,
  type ActionStatus,
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

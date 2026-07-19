import type { AgentAction, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { inngest } from "@/lib/jobs/client";
import { executeAction } from "@/lib/heimdallr/ledger";
import { ODIN_ACTION_TYPE, ODIN_MODULE } from "./draft";

// S21 — Odin executor/reverter, same shape as src/lib/bragi/executor.ts.
// "Execute" is a version-supersede write (OdinDirective is versioned exactly
// like ContentPiece/RcaDocument) plus an optional one-shot dispatch for
// mode:"dispatch" directives (odin.md §3). Directive-setting is itself
// ledger-gated — no exception for Odin.

const directivePayloadSchema = z.object({
  key: z.string().min(1),
  scope: z.enum(["tenant", "module", "category"]),
  module: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  objective: z.string().min(1),
  constraints: z.record(z.string(), z.unknown()).nullable().optional(),
  mode: z.enum(["standing", "dispatch"]),
});

interface DirectiveUndoData {
  newDirectiveId: string;
  previousActiveId: string | null;
}

/**
 * Pure version-superseding decision, scoped to one directive key — same
 * shape as bragi/executor.ts's computeNextContentVersion. Isolated from the
 * DB write so it's unit-testable without a connection.
 */
export function computeNextDirectiveVersion(
  prior: { id: string; version: number } | null,
): { nextVersion: number; supersedeId: string | null } {
  return { nextVersion: (prior?.version ?? 0) + 1, supersedeId: prior?.id ?? null };
}

/** True for AgentAction rows this executor/reverter knows how to handle. */
export function isDirectiveSetAction(action: Pick<AgentAction, "type">): boolean {
  return action.type === ODIN_ACTION_TYPE;
}

/**
 * module -> the Inngest event a "dispatch"-mode directive fires, and how to
 * shape its payload from the directive's constraints. Only Bragi is wired
 * (S21 punch list, odin.md §8) — Huginn/Muninn/Forseti dispatch targets are a
 * future follow-up, not scoped here. Returns null when the constraints don't
 * name a concrete target (no dispatch happens; the directive still saves).
 */
const DISPATCH_TARGETS: Record<
  string,
  (
    tenantId: string,
    constraints: Record<string, unknown>,
  ) => { name: string; data: Record<string, unknown> } | null
> = {
  bragi: (tenantId, constraints) => {
    const slotId = typeof constraints.slotId === "string" ? constraints.slotId : null;
    if (!slotId) return null;
    return {
      name: "bragi/content.generate.requested",
      data: {
        tenantId,
        slotId,
        ...(typeof constraints.topic === "string" ? { topicOverride: constraints.topic } : {}),
        ...(typeof constraints.brief === "string" ? { briefOverride: constraints.brief } : {}),
      },
    };
  },
};

/**
 * APPROVED odin.directive_set -> a new versioned OdinDirective for the key,
 * prior ACTIVE version (if any) flipped to SUPERSEDED, an optional dispatch
 * to the target module's job, then AgentAction -> EXECUTED with the undoData
 * needed to revert. `tenantId` is only needed for the dispatch event payload
 * (S4 standing rule: queue payloads carry IDs only) — every other write goes
 * through the tenant `prisma` like every other executor.
 */
export async function executeDirective(
  prisma: PrismaClient,
  tenantId: string,
  action: AgentAction,
): Promise<void> {
  const parsed = directivePayloadSchema.parse(action.editedPayload ?? action.payload);

  const { newDirectiveId, previousActiveId } = await prisma.$transaction(async (tx) => {
    const prior = await tx.odinDirective.findFirst({
      where: { key: parsed.key, status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    const { nextVersion, supersedeId } = computeNextDirectiveVersion(prior);

    const created = await tx.odinDirective.create({
      data: {
        key: parsed.key,
        version: nextVersion,
        scope: parsed.scope,
        module: parsed.module ?? null,
        category: parsed.category ?? null,
        objective: parsed.objective,
        constraints: (parsed.constraints ?? undefined) as never,
        mode: parsed.mode,
        sourceActionId: action.id,
      },
    });

    if (supersedeId) {
      await tx.odinDirective.update({
        where: { id: supersedeId },
        data: { status: "SUPERSEDED" },
      });
    }

    return { newDirectiveId: created.id, previousActiveId: supersedeId };
  });

  if (parsed.mode === "dispatch" && parsed.module) {
    const build = DISPATCH_TARGETS[parsed.module];
    const event = build?.(tenantId, (parsed.constraints ?? {}) as Record<string, unknown>);
    if (event) {
      await inngest.send(event);
      await prisma.odinDirective.update({
        where: { id: newDirectiveId },
        data: { dispatchedAt: new Date() },
      });
      await prisma.agentEvent.create({
        data: {
          module: ODIN_MODULE,
          category: action.category,
          action: "directive_dispatched",
          actionId: action.id,
          entity: action.entity,
          entityId: action.entityId,
          data: { targetModule: parsed.module, targetEvent: event.name },
        },
      });
    }
  }

  const undoData: DirectiveUndoData = { newDirectiveId, previousActiveId };
  await executeAction(prisma, action.id, { undoData });
}

/**
 * EXECUTED -> UNDONE odin.directive_set — called after `undoAction()` has
 * already flipped the ledger. Flips the directive version this action
 * produced to RETIRED and restores the previously-ACTIVE version, if any.
 * A dispatched job (if any already fired) is not retracted — undo only
 * reverts the directive record itself, same posture as every other module's
 * undo (it reverts the DB write, not an external side effect already sent).
 */
export async function revertDirective(prisma: PrismaClient, action: AgentAction): Promise<void> {
  const undoData = action.undoData as unknown as DirectiveUndoData | null;
  if (!undoData) return;

  await prisma.$transaction(async (tx) => {
    await tx.odinDirective.update({
      where: { id: undoData.newDirectiveId },
      data: { status: "RETIRED" },
    });
    if (undoData.previousActiveId) {
      await tx.odinDirective.update({
        where: { id: undoData.previousActiveId },
        data: { status: "ACTIVE" },
      });
    }
  });
}

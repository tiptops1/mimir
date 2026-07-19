import type { AgentAction, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { executeAction } from "@/lib/heimdallr/ledger";
import { BRAGI_ACTION_TYPE } from "./draft";

// S18 — Bragi executor/reverter, same shape as src/lib/muninn/executor.ts so
// a future generic dispatcher (Phase 1 checkpoint gap #2, still open by
// design) can absorb all three modules. "Execute" is a plain DB write: persist
// the approved draft as a versioned ContentPiece. Publishing to an external
// channel is out of scope (S18 part 1 — separate connector spike).

const contentPayloadSchema = z.object({
  channel: z.string(),
  periodKey: z.string(),
  topic: z.string(),
  title: z.string(),
  body: z.string(),
  brandVoiceKey: z.string(),
  brandVoiceVersion: z.number(),
});

interface ContentUndoData {
  contentPieceId: string;
  previousActiveId: string | null;
}

/**
 * Pure version-superseding decision, scoped to one (slot, periodKey): what
 * version the new piece gets and which row (if any) flips to SUPERSEDED.
 * Isolated from the DB write so it's unit-testable without a connection.
 */
export function computeNextContentVersion(
  prior: { id: string; version: number } | null,
): { nextVersion: number; supersedeId: string | null } {
  return { nextVersion: (prior?.version ?? 0) + 1, supersedeId: prior?.id ?? null };
}

/** True for AgentAction rows this executor/reverter knows how to handle. */
export function isContentDraftAction(action: Pick<AgentAction, "type">): boolean {
  return action.type === BRAGI_ACTION_TYPE;
}

/**
 * APPROVED content.draft -> a new versioned ContentPiece for the slot+period,
 * prior ACTIVE version (if any) flipped to SUPERSEDED, then AgentAction ->
 * EXECUTED with the undoData needed to revert. Version computed at execution
 * time so concurrent regenerations never race on a version number.
 */
export async function executeContentPiece(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  if (!action.entity || !action.entityId) {
    throw new Error(`AgentAction ${action.id}: content.draft requires entity/entityId`);
  }
  const parsed = contentPayloadSchema.parse(action.editedPayload ?? action.payload);

  const { newPieceId, previousActiveId } = await prisma.$transaction(async (tx) => {
    const prior = await tx.contentPiece.findFirst({
      where: {
        entity: action.entity!,
        entityId: action.entityId!,
        periodKey: parsed.periodKey,
        status: "ACTIVE",
      },
      orderBy: { version: "desc" },
    });
    const { nextVersion, supersedeId } = computeNextContentVersion(prior);

    const created = await tx.contentPiece.create({
      data: {
        entity: action.entity!,
        entityId: action.entityId!,
        channel: parsed.channel,
        periodKey: parsed.periodKey,
        version: nextVersion,
        status: "ACTIVE",
        title: parsed.title,
        body: parsed.body,
        brandVoiceKey: parsed.brandVoiceKey,
        brandVoiceVersion: parsed.brandVoiceVersion,
        sourceActionId: action.id,
      },
    });

    if (supersedeId) {
      await tx.contentPiece.update({
        where: { id: supersedeId },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      });
    }

    return { newPieceId: created.id, previousActiveId: supersedeId };
  });

  const undoData: ContentUndoData = { contentPieceId: newPieceId, previousActiveId };
  await executeAction(prisma, action.id, { undoData });
}

/**
 * EXECUTED -> UNDONE content.draft — called after `undoAction()` has already
 * flipped the ledger. Flips the ContentPiece this action produced to UNDONE
 * and restores the previously-ACTIVE version, if any.
 */
export async function revertContentPiece(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const undoData = action.undoData as unknown as ContentUndoData | null;
  if (!undoData) return;

  await prisma.$transaction(async (tx) => {
    await tx.contentPiece.update({
      where: { id: undoData.contentPieceId },
      data: { status: "UNDONE" },
    });
    if (undoData.previousActiveId) {
      await tx.contentPiece.update({
        where: { id: undoData.previousActiveId },
        data: { status: "ACTIVE", supersededAt: null },
      });
    }
  });
}

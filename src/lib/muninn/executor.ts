import type { AgentAction, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { executeAction } from "@/lib/heimdallr/ledger";
import { MUNINN_ACTION_TYPE } from "./draft";

// S16 — Muninn is the first module to call `executeAction` for real (Phase 1
// checkpoint gap #1, docs/mimir/decisions.md 2026-07-17): "execute" here is a
// plain DB write (persist the versioned RcaDocument), not an external side
// effect, so there's no reason to leave it stubbed. This is a Muninn-specific
// executor/reverter, not the generic dispatcher other modules will eventually
// need (gap #2 stays open — documented, not solved, here).

const rcaSectionPayloadSchema = z.object({
  key: z.string(),
  label: z.string(),
  content: z.string().nullable(),
});

const rcaDocPayloadSchema = z.object({
  templateKey: z.string(),
  templateVersion: z.number(),
  sections: z.array(rcaSectionPayloadSchema),
});

interface RcaUndoData {
  rcaDocumentId: string;
  previousActiveId: string | null;
}

/**
 * Pure version-superseding decision: given the current ACTIVE row (if any)
 * for an entity, what version number the new document gets and which row (if
 * any) flips to SUPERSEDED. Isolated from the DB write so it's unit-testable
 * without a tenant connection.
 */
export function computeNextRcaVersion(
  prior: { id: string; version: number } | null,
): { nextVersion: number; supersedeId: string | null } {
  return { nextVersion: (prior?.version ?? 0) + 1, supersedeId: prior?.id ?? null };
}

/** True for AgentAction rows this executor/reverter knows how to handle. */
export function isRcaDraftAction(action: Pick<AgentAction, "type">): boolean {
  return action.type === MUNINN_ACTION_TYPE;
}

/**
 * APPROVED doc.rca_draft -> a new versioned RcaDocument, prior ACTIVE version
 * (if any) flipped to SUPERSEDED, then AgentAction -> EXECUTED with the
 * undoData needed to revert. The version number is computed here (execution
 * time), not at propose time, so two concurrent regenerations for the same
 * activity never race on a version number.
 */
export async function executeRcaDocument(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  if (!action.entity || !action.entityId) {
    throw new Error(`AgentAction ${action.id}: doc.rca_draft requires entity/entityId`);
  }
  const parsed = rcaDocPayloadSchema.parse(action.editedPayload ?? action.payload);

  const { newDocId, previousActiveId } = await prisma.$transaction(async (tx) => {
    const prior = await tx.rcaDocument.findFirst({
      where: { entity: action.entity!, entityId: action.entityId!, status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    const { nextVersion, supersedeId } = computeNextRcaVersion(prior);

    const created = await tx.rcaDocument.create({
      data: {
        templateKey: parsed.templateKey,
        templateVersion: parsed.templateVersion,
        entity: action.entity!,
        entityId: action.entityId!,
        version: nextVersion,
        status: "ACTIVE",
        sections: parsed.sections,
        sourceActionId: action.id,
      },
    });

    if (supersedeId) {
      await tx.rcaDocument.update({
        where: { id: supersedeId },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      });
    }

    return { newDocId: created.id, previousActiveId: supersedeId };
  });

  const undoData: RcaUndoData = { rcaDocumentId: newDocId, previousActiveId };
  await executeAction(prisma, action.id, { undoData });
}

/**
 * EXECUTED -> UNDONE doc.rca_draft — called after `undoAction()` has already
 * flipped the ledger. Flips the RcaDocument this action produced to UNDONE
 * and restores the previously-ACTIVE version, if any.
 */
export async function revertRcaDocument(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const undoData = action.undoData as unknown as RcaUndoData | null;
  if (!undoData) return;

  await prisma.$transaction(async (tx) => {
    await tx.rcaDocument.update({
      where: { id: undoData.rcaDocumentId },
      data: { status: "UNDONE" },
    });
    if (undoData.previousActiveId) {
      await tx.rcaDocument.update({
        where: { id: undoData.previousActiveId },
        data: { status: "ACTIVE", supersededAt: null },
      });
    }
  });
}

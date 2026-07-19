import type { AgentAction, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { executeAction } from "@/lib/heimdallr/ledger";

// Forseti legal drafting (S23) — executor/reverter, same shape as
// src/lib/bragi/executor.ts and src/lib/muninn/executor.ts. "Execute" is a
// plain DB write: persist the approved draft as a versioned LegalDocument.
// Kept in a separate file from the existing compliance-task executor.ts —
// distinct AgentAction type/category, no shared state.

export const FORSETI_LEGAL_CATEGORY = "legal.document_draft";
export const FORSETI_LEGAL_ACTION_TYPE = "forseti.legal_document_draft";

/** PROPOSED drafts expire after this long (same posture as Bragi/Muninn). */
export const LEGAL_DRAFT_EXPIRY_DAYS = 7;

const legalPayloadSchema = z.object({
  docType: z.enum(["contract_review", "terms_draft"]),
  companyId: z.string(),
  title: z.string(),
  body: z.string(),
  inputText: z.string(),
});

interface LegalUndoData {
  legalDocumentId: string;
  previousActiveId: string | null;
}

/**
 * Pure version-superseding decision, scoped to one (entity, entityId): what
 * version the new document gets and which row (if any) flips to SUPERSEDED.
 * Isolated from the DB write so it's unit-testable without a connection.
 */
export function computeNextLegalDocVersion(
  prior: { id: string; version: number } | null,
): { nextVersion: number; supersedeId: string | null } {
  return { nextVersion: (prior?.version ?? 0) + 1, supersedeId: prior?.id ?? null };
}

/** True for AgentAction rows this executor/reverter knows how to handle. */
export function isLegalDocumentAction(action: Pick<AgentAction, "type">): boolean {
  return action.type === FORSETI_LEGAL_ACTION_TYPE;
}

/**
 * APPROVED forseti.legal_document_draft -> a new versioned LegalDocument for
 * the company, prior ACTIVE version (if any) flipped to SUPERSEDED, then
 * AgentAction -> EXECUTED with the undoData needed to revert.
 */
export async function executeLegalDocument(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const parsed = legalPayloadSchema.parse(action.editedPayload ?? action.payload);

  const { newDocumentId, previousActiveId } = await prisma.$transaction(async (tx) => {
    const prior = await tx.legalDocument.findFirst({
      where: { entity: "COMPANY", entityId: parsed.companyId, status: "ACTIVE" },
      orderBy: { version: "desc" },
    });
    const { nextVersion, supersedeId } = computeNextLegalDocVersion(prior);

    const created = await tx.legalDocument.create({
      data: {
        docType: parsed.docType,
        entity: "COMPANY",
        entityId: parsed.companyId,
        version: nextVersion,
        status: "ACTIVE",
        title: parsed.title,
        body: parsed.body,
        inputText: parsed.inputText,
        sourceActionId: action.id,
      },
    });

    if (supersedeId) {
      await tx.legalDocument.update({
        where: { id: supersedeId },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      });
    }

    return { newDocumentId: created.id, previousActiveId: supersedeId };
  });

  const undoData: LegalUndoData = { legalDocumentId: newDocumentId, previousActiveId };
  await executeAction(prisma, action.id, { undoData });
}

/**
 * EXECUTED -> UNDONE forseti.legal_document_draft — called after `undoAction()`
 * has already flipped the ledger. Flips the LegalDocument this action produced
 * to UNDONE and restores the previously-ACTIVE version, if any.
 */
export async function revertLegalDocument(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const undoData = action.undoData as unknown as LegalUndoData | null;
  if (!undoData) return;

  await prisma.$transaction(async (tx) => {
    await tx.legalDocument.update({
      where: { id: undoData.legalDocumentId },
      data: { status: "UNDONE" },
    });
    if (undoData.previousActiveId) {
      await tx.legalDocument.update({
        where: { id: undoData.previousActiveId },
        data: { status: "ACTIVE", supersededAt: null },
      });
    }
  });
}

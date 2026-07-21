"use server";

import { revalidatePath } from "next/cache";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { approveAction, rejectAction, undoAction } from "@/lib/heimdallr/ledger";
import { InvalidTransitionError } from "@/lib/heimdallr/state-machine";
import { executeRcaDocument, isRcaDraftAction, revertRcaDocument } from "@/lib/muninn/executor";
import {
  executeContentPiece,
  isContentDraftAction,
  revertContentPiece,
} from "@/lib/bragi/executor";
import {
  executeComplianceTask,
  isComplianceTaskAction,
  revertComplianceTask,
} from "@/lib/forseti/executor";
import { executeDirective, isDirectiveSetAction, revertDirective } from "@/lib/odin/executor";
import {
  executeRenewalOutreach,
  isRenewalOutreachAction,
  revertRenewalOutreach,
} from "@/lib/thor/executor";
import {
  executeLegalDocument,
  isLegalDocumentAction,
  revertLegalDocument,
} from "@/lib/forseti/legal-executor";
import {
  executeCampaignDecision,
  isCampaignDecisionAction,
  revertCampaignDecision,
} from "@/lib/freyja/executor";

/** Approve a proposal unchanged. Returns an error string on failure, else null. */
export async function approveActionSA(id: string): Promise<string | null> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  try {
    const action = await approveAction(prisma, id, { decidedBy: session.userId });
    if (isRcaDraftAction(action)) await executeRcaDocument(prisma, action);
    if (isContentDraftAction(action)) await executeContentPiece(prisma, action);
    if (isComplianceTaskAction(action)) await executeComplianceTask(prisma, action);
    if (isDirectiveSetAction(action)) await executeDirective(prisma, session.tenantId, action);
    if (isRenewalOutreachAction(action)) await executeRenewalOutreach(prisma, action);
    if (isLegalDocumentAction(action)) await executeLegalDocument(prisma, action);
    if (isCampaignDecisionAction(action)) await executeCampaignDecision(prisma, action);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return err.message;
    throw err;
  }
  revalidatePath("/heimdallr/inbox");
  return null;
}

/** Edit-then-approve: approves with editedPayload set, per ledger.ts. */
export async function approveEditedActionSA(
  id: string,
  editedPayload: unknown,
): Promise<string | null> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  try {
    const action = await approveAction(prisma, id, { decidedBy: session.userId, editedPayload });
    if (isRcaDraftAction(action)) await executeRcaDocument(prisma, action);
    if (isContentDraftAction(action)) await executeContentPiece(prisma, action);
    if (isComplianceTaskAction(action)) await executeComplianceTask(prisma, action);
    if (isDirectiveSetAction(action)) await executeDirective(prisma, session.tenantId, action);
    if (isRenewalOutreachAction(action)) await executeRenewalOutreach(prisma, action);
    if (isLegalDocumentAction(action)) await executeLegalDocument(prisma, action);
    if (isCampaignDecisionAction(action)) await executeCampaignDecision(prisma, action);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return err.message;
    throw err;
  }
  revalidatePath("/heimdallr/inbox");
  return null;
}

/** Reject a proposal. Human decision only, per ledger.ts. */
export async function rejectActionSA(id: string): Promise<string | null> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  try {
    await rejectAction(prisma, id, session.userId);
  } catch (err) {
    if (err instanceof InvalidTransitionError) return err.message;
    throw err;
  }
  revalidatePath("/heimdallr/inbox");
  return null;
}

/** Undo an executed, reversible action within its category's undo window. */
export async function undoActionSA(id: string): Promise<string | null> {
  await verifySession();
  const prisma = await getTenantDb();
  const action = await prisma.agentAction.findUnique({
    where: { id },
    select: { category: true },
  });
  if (!action) return "Action introuvable.";
  const config = await prisma.autonomyConfig.findUnique({
    where: { category: action.category },
    select: { undoWindowMinutes: true },
  });
  const undoWindowMinutes = config?.undoWindowMinutes ?? 60;
  try {
    const undone = await undoAction(prisma, id, undoWindowMinutes);
    if (isRcaDraftAction(undone)) await revertRcaDocument(prisma, undone);
    if (isContentDraftAction(undone)) await revertContentPiece(prisma, undone);
    if (isComplianceTaskAction(undone)) await revertComplianceTask(prisma, undone);
    if (isDirectiveSetAction(undone)) await revertDirective(prisma, undone);
    if (isRenewalOutreachAction(undone)) await revertRenewalOutreach(prisma, undone);
    if (isLegalDocumentAction(undone)) await revertLegalDocument(prisma, undone);
    if (isCampaignDecisionAction(undone)) await revertCampaignDecision(prisma, undone);
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
  revalidatePath("/heimdallr/inbox");
  return null;
}

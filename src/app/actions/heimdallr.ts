"use server";

import { revalidatePath } from "next/cache";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { approveAction, rejectAction, undoAction } from "@/lib/heimdallr/ledger";
import { InvalidTransitionError } from "@/lib/heimdallr/state-machine";

/** Approve a proposal unchanged. Returns an error string on failure, else null. */
export async function approveActionSA(id: string): Promise<string | null> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  try {
    await approveAction(prisma, id, { decidedBy: session.userId });
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
    await approveAction(prisma, id, { decidedBy: session.userId, editedPayload });
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
    await undoAction(prisma, id, undoWindowMinutes);
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
  revalidatePath("/heimdallr/inbox");
  return null;
}

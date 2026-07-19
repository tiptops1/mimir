import type { AgentAction, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { executeAction } from "@/lib/heimdallr/ledger";
import { THOR_RENEWAL_ACTION_TYPE } from "./renewal";

// S22b — Thor executor/reverter, same shape as src/lib/forseti/executor.ts.
// "Execute" is a plain DB write: create a follow-up Task carrying the drafted
// subject/body for a human to act on (no email-send capability exists yet —
// same posture as Huginn's still-unwired email.draft_reply). Task has no
// ACTIVE/SUPERSEDED lifecycle, so revert is a straight delete rather than a
// status flip.

const renewalPayloadSchema = z.object({
  companyId: z.string(),
  companyName: z.string(),
  band: z.string(),
  score: z.number(),
  signals: z.array(z.object({ key: z.string(), label: z.string(), detail: z.string() })),
  subject: z.string(),
  body: z.string(),
});

interface RenewalUndoData {
  taskId: string;
}

/** True for AgentAction rows this executor/reverter knows how to handle. */
export function isRenewalOutreachAction(action: Pick<AgentAction, "type">): boolean {
  return action.type === THOR_RENEWAL_ACTION_TYPE;
}

/** APPROVED thor.renewal -> a new Task, then AgentAction -> EXECUTED. */
export async function executeRenewalOutreach(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const parsed = renewalPayloadSchema.parse(action.editedPayload ?? action.payload);

  const task = await prisma.task.create({
    data: {
      title: `Relance fidélisation — ${parsed.companyName}`,
      type: "RELANCE",
      source: "THOR",
      companyId: parsed.companyId,
      note: `${parsed.subject}\n\n${parsed.body}`,
    },
  });

  const undoData: RenewalUndoData = { taskId: task.id };
  await executeAction(prisma, action.id, { undoData });
}

/** EXECUTED -> UNDONE thor.renewal — deletes the Task it created. */
export async function revertRenewalOutreach(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const undoData = action.undoData as unknown as RenewalUndoData | null;
  if (!undoData) return;
  await prisma.task.delete({ where: { id: undoData.taskId } }).catch(() => {
    // Already deleted (e.g. manually) — undo is idempotent, nothing else to do.
  });
}

import type { AgentAction, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { executeAction } from "@/lib/heimdallr/ledger";
import { FORSETI_TASK_ACTION_TYPE } from "./snapshot";

// S19 — Forseti executor/reverter, same shape as src/lib/muninn/executor.ts
// and src/lib/bragi/executor.ts. "Execute" is a plain DB write: create the
// follow-up Task. Unlike RcaDocument/ContentPiece, Task has no
// ACTIVE/SUPERSEDED lifecycle, so revert is a straight delete rather than a
// status flip.

const compliancePayloadSchema = z.object({
  issueKey: z.string(),
  companyId: z.string(),
  title: z.string(),
  dueDate: z.string().nullable(),
  note: z.string(),
});

interface ComplianceUndoData {
  taskId: string;
}

/** True for AgentAction rows this executor/reverter knows how to handle. */
export function isComplianceTaskAction(action: Pick<AgentAction, "type">): boolean {
  return action.type === FORSETI_TASK_ACTION_TYPE;
}

/** APPROVED forseti.compliance_task -> a new Task, then AgentAction -> EXECUTED. */
export async function executeComplianceTask(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const parsed = compliancePayloadSchema.parse(action.editedPayload ?? action.payload);

  const task = await prisma.task.create({
    data: {
      title: parsed.title,
      type: "CONFORMITE",
      source: "FORSETI",
      companyId: parsed.companyId,
      dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
      note: parsed.note,
    },
  });

  const undoData: ComplianceUndoData = { taskId: task.id };
  await executeAction(prisma, action.id, { undoData });
}

/** EXECUTED -> UNDONE forseti.compliance_task — deletes the Task it created. */
export async function revertComplianceTask(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const undoData = action.undoData as unknown as ComplianceUndoData | null;
  if (!undoData) return;
  await prisma.task.delete({ where: { id: undoData.taskId } }).catch(() => {
    // Already deleted (e.g. manually) — undo is idempotent, nothing else to do.
  });
}

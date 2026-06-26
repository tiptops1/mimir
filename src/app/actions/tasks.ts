"use server";

import { revalidatePath } from "next/cache";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { taskSchema } from "@/lib/validations";
import type { FormResult } from "@/app/actions/companies";

/** Revalidate every surface that shows tasks. */
function revalidateTaskViews(companyId?: string | null) {
  revalidatePath("/todo");
  revalidatePath("/dashboard");
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

// Completing a task logs a matching activity, so the work shows in the timeline
// and bumps the prospect's last touch. Map the task kind to an activity type.
const TASK_TO_ACTIVITY_TYPE: Record<string, string> = {
  APPEL: "CALL",
  EMAIL: "EMAIL",
  RDV: "MEETING",
  RELANCE: "NOTE",
  AUTRE: "NOTE",
};

export async function createTask(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const parsed = taskSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Tâche invalide." };
  }
  await prisma.task.create({
    data: {
      companyId: parsed.data.companyId,
      title: parsed.data.title,
      type: parsed.data.type,
      dueDate: parsed.data.dueDate,
      note: parsed.data.note,
      source: "MANUAL",
      userId: session.userId,
    },
  });
  revalidateTaskViews(parsed.data.companyId);
  return { ok: true };
}

export async function toggleTask(id: string, done: boolean): Promise<void> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const existing = await prisma.task.findUnique({
    where: { id },
    select: { done: true, companyId: true, title: true, type: true },
  });
  if (!existing) return;

  await prisma.task.update({
    where: { id },
    data: { done, doneAt: done ? new Date() : null },
  });

  // On a real completion (open → done), log a matching activity and refresh the
  // company's last touch so the timeline + staleness widgets stay accurate.
  if (done && !existing.done && existing.companyId) {
    await prisma.activity.create({
      data: {
        companyId: existing.companyId,
        type: TASK_TO_ACTIVITY_TYPE[existing.type] ?? "NOTE",
        note: `Tâche terminée : ${existing.title}`,
        userId: session.userId,
      },
    });
    await prisma.company.update({
      where: { id: existing.companyId },
      data: { dernierContact: new Date() },
    });
  }

  revalidateTaskViews(existing.companyId);
}

/** Reschedule a task to an explicit date (or clear it → "À planifier"). */
export async function setTaskDue(
  id: string,
  date: string | null,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  let dueDate: Date | null = null;
  if (date) {
    const d = new Date(date);
    dueDate = Number.isNaN(d.getTime()) ? null : d;
  }
  const task = await prisma.task.update({
    where: { id },
    data: { dueDate },
    select: { companyId: true },
  });
  revalidateTaskViews(task.companyId);
}

/** Push a task's due date out by N days from today (snooze). */
export async function snoozeTask(id: string, days: number): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const due = new Date();
  due.setHours(0, 0, 0, 0);
  due.setDate(due.getDate() + days);
  const task = await prisma.task.update({
    where: { id },
    data: { dueDate: due },
    select: { companyId: true },
  });
  revalidateTaskViews(task.companyId);
}

export async function deleteTask(id: string): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const task = await prisma.task.delete({
    where: { id },
    select: { companyId: true },
  });
  revalidateTaskViews(task.companyId);
}

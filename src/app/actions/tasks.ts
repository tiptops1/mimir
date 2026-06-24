"use server";

import { revalidatePath } from "next/cache";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { taskSchema } from "@/lib/validations";
import type { FormResult } from "@/app/actions/companies";

/** Revalidate every surface that shows tasks. */
function revalidateTaskViews(companyId?: string) {
  revalidatePath("/todo");
  revalidatePath("/dashboard");
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

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
  await verifySession();
  const prisma = await getTenantDb();
  const task = await prisma.task.update({
    where: { id },
    data: { done, doneAt: done ? new Date() : null },
    select: { companyId: true },
  });
  revalidateTaskViews(task.companyId);
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

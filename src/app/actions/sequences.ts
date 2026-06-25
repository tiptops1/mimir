"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { parseSteps, dueAt } from "@/lib/sequences";

// Enroll / pause / resume / remove a company in an outreach sequence. The cron
// (advanceSequences) does the actual step materialization.

export async function enrollCompany(
  companyId: string,
  sequenceId: string,
  contactId?: string | null,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!seq || !seq.active) return;
  const steps = parseSteps(seq.steps);
  if (steps.length === 0) return;
  const start = new Date();
  await prisma.enrollment.create({
    data: {
      companyId,
      sequenceId,
      contactId: contactId || undefined,
      currentStep: 0,
      nextDueAt: dueAt(start, steps, 0),
      status: "ACTIVE",
    },
  });
  revalidatePath(`/companies/${companyId}`);
}

/** Pause or resume an enrollment (status ACTIVE | PAUSED). */
export async function setEnrollmentStatus(
  enrollmentId: string,
  companyId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  await prisma.enrollment.update({ where: { id: enrollmentId }, data: { status } });
  revalidatePath(`/companies/${companyId}`);
}

export async function deleteEnrollment(
  enrollmentId: string,
  companyId: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  await prisma.enrollment.delete({ where: { id: enrollmentId } });
  revalidatePath(`/companies/${companyId}`);
}

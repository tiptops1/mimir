"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { parseSteps, dueAt } from "@/lib/sequences";
import { canEnroll } from "@/lib/outreach/enroll";
import {
  addBusinessDays,
  startOfParisDay,
} from "@/lib/outreach/business-days";
import type { PrismaClient } from "@prisma/client";

// Enroll / pause / resume / remove a company in an outreach sequence. TASKS
// sequences are advanced by the 4h cron; AUTO_EMAIL ones by the send engine —
// enrolling in the latter runs the full cold-email guard (blocked, opted out,
// no usable address, already enrolled, already replied) and returns a French
// error instead of silently creating a doomed enrollment.

export interface EnrollResult {
  ok?: boolean;
  error?: string;
}

async function createEnrollment(
  prisma: PrismaClient,
  seq: { id: string; mode: string; steps: unknown },
  companyId: string,
  contactId?: string | null,
): Promise<void> {
  const steps = parseSteps(seq.steps);
  const start = new Date();
  const first = steps[0];
  // AUTO_EMAIL delays count business days, due from the target day's start.
  const firstDue =
    seq.mode === "AUTO_EMAIL"
      ? first.offsetDays === 0
        ? start
        : startOfParisDay(addBusinessDays(start, first.offsetDays))
      : dueAt(start, steps, 0);
  await prisma.enrollment.create({
    data: {
      companyId,
      sequenceId: seq.id,
      contactId: contactId || undefined,
      currentStep: 0,
      nextDueAt: firstDue,
      status: "ACTIVE",
    },
  });
}

export async function enrollCompany(
  companyId: string,
  sequenceId: string,
  contactId?: string | null,
): Promise<EnrollResult> {
  await verifySession();
  const prisma = await getTenantDb();
  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!seq || !seq.active) return { error: "Séquence introuvable ou inactive." };
  if (parseSteps(seq.steps).length === 0) {
    return { error: "Cette séquence n'a aucune étape." };
  }

  if (seq.mode === "AUTO_EMAIL") {
    const check = await canEnroll(prisma, companyId, {
      preferredContactId: contactId,
    });
    if (!check.ok) return { error: check.reason };
  } else {
    const existing = await prisma.enrollment.findFirst({
      where: { companyId, sequenceId, status: { in: ["ACTIVE", "PAUSED"] } },
    });
    if (existing) return { error: "Déjà inscrite dans cette séquence." };
  }

  await createEnrollment(prisma, seq, companyId, contactId);
  revalidatePath(`/companies/${companyId}`);
  return { ok: true };
}

export interface BulkEnrollResult {
  enrolled: number;
  skipped: { id: string; name: string; reason: string }[];
}

/** Bulk enroll from the Suivi selection bar. Guards run per company. */
export async function bulkEnrollCompanies(
  ids: string[],
  sequenceId: string,
): Promise<BulkEnrollResult> {
  await verifySession();
  const prisma = await getTenantDb();
  const result: BulkEnrollResult = { enrolled: 0, skipped: [] };

  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!seq || !seq.active || parseSteps(seq.steps).length === 0) return result;

  const unique = [...new Set(ids)].slice(0, 500);
  for (const companyId of unique) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { nomSociete: true, enseigne: true },
    });
    if (!company) continue;
    const name = company.enseigne || company.nomSociete || companyId;

    if (seq.mode === "AUTO_EMAIL") {
      const check = await canEnroll(prisma, companyId);
      if (!check.ok) {
        result.skipped.push({ id: companyId, name, reason: check.reason });
        continue;
      }
    } else {
      const existing = await prisma.enrollment.findFirst({
        where: { companyId, sequenceId, status: { in: ["ACTIVE", "PAUSED"] } },
      });
      if (existing) {
        result.skipped.push({ id: companyId, name, reason: "Déjà inscrite." });
        continue;
      }
    }
    await createEnrollment(prisma, seq, companyId);
    result.enrolled++;
  }

  revalidatePath("/companies");
  revalidatePath("/outreach");
  return result;
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

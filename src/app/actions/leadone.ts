"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { promoteCandidate } from "@/lib/leadone/promote";
import { canEnroll } from "@/lib/outreach/enroll";
import { parseSteps } from "@/lib/sequences";
import { addBusinessDays, startOfParisDay } from "@/lib/outreach/business-days";

// Review-queue actions for /leadone. Approve funnels through the same
// promoteCandidate() guards as the batch CLI (SIRET / domain / name dedupe +
// BlockedSender), so a double-click or a stale row can never create a
// duplicate Company.

function revalidateLeadOne() {
  revalidatePath("/leadone");
  revalidatePath("/companies");
  revalidatePath("/pipeline");
}

// Both actions return void (plain <form action> usage). A duplicate approve
// marks the candidate REJECTED with lastError "duplicate:…" — it simply leaves
// the queue on revalidation, and the audit/lastError trail says why.
export async function approveCandidate(candidateId: string): Promise<void> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const result = await promoteCandidate(prisma, candidateId, session.userId);

  // Optional auto-enrollment: OutreachConfig.autoEnrollSequenceId picks an
  // AUTO_EMAIL sequence to attach every freshly promoted company to. Deliberately
  // NOT inside promote.ts — the batch CLI must not auto-enroll (no operator around
  // to react to a bad first send). Guarded by canEnroll so a blocked or
  // address-less company just skips silently.
  if (result.outcome === "PROMOTED" && result.companyId) {
    const config = await prisma.outreachConfig.findFirst();
    if (config?.autoEnrollSequenceId && !config.paused) {
      const seq = await prisma.sequence.findUnique({
        where: { id: config.autoEnrollSequenceId },
      });
      if (seq && seq.active && seq.mode === "AUTO_EMAIL") {
        const steps = parseSteps(seq.steps);
        if (steps.length > 0) {
          const check = await canEnroll(prisma, result.companyId);
          if (check.ok) {
            const start = new Date();
            const firstDue =
              steps[0].offsetDays === 0
                ? start
                : startOfParisDay(addBusinessDays(start, steps[0].offsetDays));
            await prisma.enrollment.create({
              data: {
                companyId: result.companyId,
                sequenceId: seq.id,
                currentStep: 0,
                nextDueAt: firstDue,
                status: "ACTIVE",
              },
            });
          }
        }
      }
    }
  }

  revalidateLeadOne();
}

export async function rejectCandidate(candidateId: string): Promise<void> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  await prisma.leadCandidate.update({
    where: { id: candidateId },
    data: {
      status: "REJECTED",
      lastError: "manual-reject",
      reviewedBy: session.userId,
    },
  });
  revalidatePath("/leadone");
}

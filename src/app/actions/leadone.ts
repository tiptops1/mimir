"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { promoteCandidate } from "@/lib/leadone/promote";

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
  await promoteCandidate(prisma, candidateId, session.userId);
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

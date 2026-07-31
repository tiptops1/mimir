import type { AgentAction, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { executeAction, failAction } from "@/lib/heimdallr/ledger";
import { KAIROS_ACTION_TYPE } from "./kairos";

// Kairos executor/reverter (S32). Same shape as forseti/executor.ts and
// thor/executor.ts.
//
// WHAT "EXECUTE" MEANS HERE, precisely: it records that a human approved a
// maximum bid. It does NOT place a bid, make an offer, or contact a seller —
// there is no code path in this repository that can, and adding one would be a
// separate decision with its own approval design. `chronos.sourcing_offer` is
// seeded at maxLevel 1 (never graduates) for the same reason
// finance.commitment is: this is money.
//
// The re-check below mirrors Freyja's guardrail exactly, and exists for the
// same reason: between proposal and approval a human may have EDITED the bid,
// or the proposal may have gone stale while the reference's comp band moved.
// Executing an approved number without re-validating it against the ceiling
// stored at scan time would let an edit bypass the arithmetic that is supposed
// to be the authority.

const offerPayloadSchema = z.object({
  candidateId: z.string(),
  refId: z.string(),
  refLabel: z.string(),
  listingTitle: z.string(),
  listingUrl: z.string().nullable().optional(),
  askPriceCents: z.number().int(),
  maxBidCents: z.number().int(),
  expectedResaleCents: z.number().int(),
  rationale: z.string(),
  flags: z.array(z.object({ key: z.string(), label: z.string(), severity: z.string() })),
});

interface OfferUndoData {
  candidateId: string;
  previousStatus: string;
  previousApprovedBidCents: number | null;
}

/** True for AgentAction rows this executor/reverter knows how to handle. */
export function isSourcingOfferAction(action: Pick<AgentAction, "type">): boolean {
  return action.type === KAIROS_ACTION_TYPE;
}

/**
 * APPROVED sourcing.offer -> the candidate carries the signed-off bid ceiling.
 *
 * Refuses (fails the action, does not clamp) when the approved figure exceeds
 * the ceiling computed at scan time. Failing loudly beats silently lowering a
 * number a human deliberately typed — they need to know their edit was rejected
 * and why, which is exactly the posture Freyja's budget-delta cap established.
 */
export async function executeSourcingOffer(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const parsed = offerPayloadSchema.parse(action.editedPayload ?? action.payload);

  const candidate = await prisma.sourcingCandidate.findUnique({
    where: { id: parsed.candidateId },
    select: { id: true, status: true, approvedBidCents: true, maxBidCents: true },
  });
  if (!candidate) {
    await failAction(prisma, action.id, `Annonce introuvable : ${parsed.candidateId}`);
    return;
  }

  const ceiling = candidate.maxBidCents ?? 0;
  if (parsed.maxBidCents > ceiling) {
    await prisma.agentEvent.create({
      data: {
        module: "kairos",
        category: "chronos.sourcing_offer",
        action: "guardrail_blocked",
        entity: "SOURCING_CANDIDATE",
        entityId: candidate.id,
        data: {
          reason: "bid_above_ceiling",
          approvedBidCents: parsed.maxBidCents,
          ceilingCents: ceiling,
        },
      },
    });
    await failAction(
      prisma,
      action.id,
      `Enchère approuvée (${parsed.maxBidCents}) au-dessus du plafond calculé ` +
        `(${ceiling}) — refusée.`,
    );
    return;
  }

  const undoData: OfferUndoData = {
    candidateId: candidate.id,
    previousStatus: candidate.status,
    previousApprovedBidCents: candidate.approvedBidCents,
  };

  await prisma.sourcingCandidate.update({
    where: { id: candidate.id },
    data: { status: "APPROVED", approvedBidCents: parsed.maxBidCents },
  });

  await executeAction(prisma, action.id, { undoData });
}

/** EXECUTED -> UNDONE sourcing.offer — restores the candidate's prior state. */
export async function revertSourcingOffer(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const undoData = action.undoData as unknown as OfferUndoData | null;
  if (!undoData) return;
  await prisma.sourcingCandidate
    .update({
      where: { id: undoData.candidateId },
      data: {
        status: undoData.previousStatus,
        approvedBidCents: undoData.previousApprovedBidCents,
      },
    })
    .catch(() => {
      // Candidate deleted since — undo is idempotent, nothing else to do.
    });
}

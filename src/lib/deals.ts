import type { PrismaClient } from "@prisma/client";

// Deal <-> Company stage write-through. The pipeline board stays company-keyed,
// so the company's primary deal and Company.stage are kept in sync: a board/inline
// stage change mirrors onto the primary deal, and a primary-deal stage change
// mirrors back onto the company. Additional (non-primary) deals are independent
// opportunities and never touch Company.stage.

const WON = "GAGNE";
const LOST = "PERDU";

export type DealStatus = "OPEN" | "WON" | "LOST";

/** Derive a deal's status from its pipeline stage (GAGNE→WON, PERDU→LOST). */
export function statusForStage(stage: string): DealStatus {
  if (stage === WON) return "WON";
  if (stage === LOST) return "LOST";
  return "OPEN";
}

/**
 * Ensure the company has a primary deal, creating one (mirroring the company's
 * current stage) if missing. Returns its id. Safe to call repeatedly.
 */
export async function ensurePrimaryDeal(
  prisma: PrismaClient,
  companyId: string,
  fallbackStage = "A_QUALIFIER",
): Promise<string> {
  const existing = await prisma.deal.findFirst({
    where: { companyId, isPrimary: true },
    select: { id: true },
  });
  if (existing) return existing.id;
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { stage: true },
  });
  const stage = company?.stage ?? fallbackStage;
  const deal = await prisma.deal.create({
    data: { companyId, stage, status: statusForStage(stage), isPrimary: true },
  });
  return deal.id;
}

/** Write-through company.stage → its primary deal (used by board drag + inline stage). */
export async function mirrorStageToPrimaryDeal(
  prisma: PrismaClient,
  companyId: string,
  stage: string,
): Promise<void> {
  const dealId = await ensurePrimaryDeal(prisma, companyId, stage);
  await prisma.deal.update({
    where: { id: dealId },
    data: { stage, status: statusForStage(stage) },
  });
}

"use server";

import type { PipelineStage } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { statusForStage } from "@/lib/deals";
import { PIPELINE_STAGES } from "@/lib/constants";

// CRUD for opportunities (affaires) on the company fiche. The company's PRIMARY
// deal mirrors the pipeline board (its stage write-throughs to Company.stage);
// additional deals are independent opportunities and never touch Company.stage.

const STAGE_VALUES = PIPELINE_STAGES.map((s) => s.value) as string[];

export interface DealFormResult {
  error?: string;
  ok?: boolean;
}

export async function createDeal(
  _prev: DealFormResult | undefined,
  formData: FormData,
): Promise<DealFormResult> {
  await verifySession();
  const prisma = await getTenantDb();
  const companyId = String(formData.get("companyId") ?? "").trim();
  if (!companyId) return { error: "Société manquante." };
  const title = String(formData.get("title") ?? "").trim() || "Opportunité";
  const product = String(formData.get("product") ?? "").trim() || null;
  const stageRaw = String(formData.get("stage") ?? "A_QUALIFIER");
  const stage = STAGE_VALUES.includes(stageRaw) ? stageRaw : "A_QUALIFIER";
  const amountDigits = String(formData.get("amount") ?? "").replace(/[^0-9]/g, "");
  const amount = amountDigits ? Number.parseInt(amountDigits, 10) : null;

  await prisma.deal.create({
    data: {
      companyId,
      title,
      product,
      stage,
      status: statusForStage(stage),
      amount,
      isPrimary: false, // the primary deal is seeded by backfill / write-through
    },
  });
  revalidatePath(`/companies/${companyId}`);
  return { ok: true };
}

/** Change a deal's stage; the primary deal mirrors back onto Company.stage. */
export async function setDealStage(
  dealId: string,
  companyId: string,
  stage: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  if (!STAGE_VALUES.includes(stage)) return;
  const deal = await prisma.deal.update({
    where: { id: dealId },
    data: { stage, status: statusForStage(stage) },
  });
  if (deal.isPrimary) {
    await prisma.company.update({
      where: { id: companyId },
      data: {
        stage: stage as PipelineStage,
        ...(stage === "DEMO_REALISEE" ? { demoRealisee: true } : {}),
        ...(stage === "PROPOSITION_ENVOYEE" ? { propositionEnvoyee: true } : {}),
      },
    });
  }
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
  revalidatePath("/pipeline");
}

/** Delete a (non-primary) opportunity. The primary deal is protected — it backs the board. */
export async function deleteDeal(dealId: string, companyId: string): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { isPrimary: true },
  });
  if (!deal || deal.isPrimary) return;
  await prisma.deal.delete({ where: { id: dealId } });
  revalidatePath(`/companies/${companyId}`);
}

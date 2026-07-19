"use server";

import { revalidatePath } from "next/cache";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { proposeAction } from "@/lib/heimdallr/ledger";
import {
  draftLegalDocument,
  type LegalDocType,
} from "@/lib/forseti/legal-draft";
import {
  FORSETI_LEGAL_CATEGORY,
  FORSETI_LEGAL_ACTION_TYPE,
  LEGAL_DRAFT_EXPIRY_DAYS,
} from "@/lib/forseti/legal-executor";

// Forseti legal drafting (S23) — on-demand submission from /forseti/legal.
// Unlike the compliance sweep, this is user-triggered (a broker pastes a
// contract/terms brief), not swept by cron: draft, then propose via the
// ledger like Bragi/Muninn/Thor's manual-trigger paths.

export type LegalDraftSubmitResult =
  | { outcome: "proposed" }
  | { outcome: "quarantined" }
  | { outcome: "failed" }
  | { outcome: "error"; message: string };

export async function submitLegalDraftSA(
  companyId: string,
  docType: LegalDocType,
  inputText: string,
): Promise<LegalDraftSubmitResult> {
  await verifySession();
  const prisma = await getTenantDb();

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { nomSociete: true, enseigne: true, siret: true },
  });
  if (!company) return { outcome: "error", message: "Société introuvable." };
  const companyName = company.nomSociete ?? company.enseigne ?? company.siret;

  let result;
  try {
    result = await draftLegalDocument(prisma, { docType, companyId, companyName, inputText });
  } catch (err) {
    return { outcome: "error", message: (err as Error).message };
  }

  if (result.outcome !== "drafted") return { outcome: result.outcome };

  const config = await prisma.autonomyConfig.findUnique({
    where: { category: FORSETI_LEGAL_CATEGORY },
    select: { level: true },
  });

  await proposeAction(prisma, {
    module: "forseti",
    category: FORSETI_LEGAL_CATEGORY,
    type: FORSETI_LEGAL_ACTION_TYPE,
    payload: {
      docType,
      companyId,
      companyName,
      title: result.draft.title,
      body: result.draft.body,
      inputText,
    },
    trigger: { kind: "manual" },
    entity: "COMPANY",
    entityId: companyId,
    autonomyLevelAtProposal: config?.level ?? 0,
    promptKey: result.promptKey,
    promptVersion: result.promptVersion,
    reversible: true,
    expiresAt: new Date(Date.now() + LEGAL_DRAFT_EXPIRY_DAYS * 86_400_000),
  });

  revalidatePath("/forseti/legal");
  return { outcome: "proposed" };
}

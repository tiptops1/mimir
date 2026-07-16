"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { getTenantConfig } from "@/lib/tenant-config";
import { authedClientForTenant } from "@/lib/google-oauth";
import { buildProspectDossier, composeProspectingEmail } from "@/lib/email-research";
import { aiEnabled } from "@/lib/ai-extract";
import { sendGmail } from "@/lib/gmail-send";

// Server actions behind the company-fiche email composer: (1) AI-generate a
// researched draft (nothing persisted), (2) send via Gmail + log the activity.

export interface DraftResult {
  ok?: boolean;
  error?: string;
  subject?: string;
  body?: string;
  sources?: string[];
}

/**
 * Generate a tailored prospecting email draft for a contact, grounded in a
 * documented dossier (CRM record + activity history + live web research).
 * Returns the draft; it is NOT sent or stored — the user reviews it first.
 */
export async function generateEmailDraft(
  companyId: string,
  contactId?: string | null,
): Promise<DraftResult> {
  await verifySession();
  if (!aiEnabled()) {
    return { error: "Aucun fournisseur IA configuré (GEMINI_API_KEY)." };
  }
  const prisma = await getTenantDb();
  const dossier = await buildProspectDossier(prisma, companyId, contactId);
  if (!dossier.companyLabel) return { error: "Société introuvable." };

  const composed = await composeProspectingEmail(prisma, {
    dossier: dossier.dossier,
    senderName: getTenantConfig().owner.name,
    companyLabel: dossier.companyLabel,
    contactLabel: dossier.contactLabel,
    contactFirstName: dossier.contactFirstName,
  });
  if (!composed) {
    return { error: "La génération a échoué. Réessayez dans un instant." };
  }
  return {
    ok: true,
    subject: composed.subject,
    body: composed.body,
    sources: dossier.sources,
  };
}

export interface SendResult {
  ok?: boolean;
  error?: string;
}

/** Send an email to a contact via the connected Gmail account and log it. */
export async function sendEmail(
  _prev: SendResult | undefined,
  formData: FormData,
): Promise<SendResult> {
  const session = await verifySession();
  const prisma = await getTenantDb();

  const companyId = String(formData.get("companyId") ?? "").trim();
  const contactId = String(formData.get("contactId") ?? "").trim() || null;
  const to = String(formData.get("to") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!companyId || !to || !subject || !body) {
    return { error: "Destinataire, objet et message sont requis." };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return { error: "Adresse email du destinataire invalide." };
  }

  const authed = await authedClientForTenant(session.tenantId);
  if (!authed) {
    return { error: "Compte Google non connecté. Connectez Google pour envoyer." };
  }

  let messageId: string;
  try {
    const sent = await sendGmail(authed.client, {
      fromName: getTenantConfig().owner.name,
      fromEmail: authed.accountEmail,
      to,
      subject,
      body,
    });
    messageId = sent.messageId;
  } catch (e) {
    return { error: `Échec de l'envoi : ${(e as Error).message}` };
  }

  // Log the sent mail as an OUTBOUND email activity (same shape the sync produces),
  // so the timeline + staleness widgets stay accurate and the AI pass enriches it.
  await prisma.activity.create({
    data: {
      companyId,
      contactId: contactId || undefined,
      type: "EMAIL",
      direction: "OUTBOUND",
      subject,
      body,
      toEmail: to,
      fromEmail: authed.accountEmail,
      messageId,
      userId: session.userId,
    },
  });
  await prisma.company.update({
    where: { id: companyId },
    data: { dernierContact: new Date() },
  });

  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { verifySession, requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { logAudit } from "@/lib/audit";

// RGPD actions (P2.4). FR insurance prospecting handles personal data, so the
// CRM offers per-contact consent tracking, data export (droit d'accès) and
// erasure (droit à l'effacement). Erase and export are ADMIN-only + audited.

export interface RgpdResult {
  error?: string;
  ok?: boolean;
}

const CONSENT_VALUES = ["OPT_IN", "OPT_OUT"];

export async function setContactConsent(
  id: string,
  value: string,
): Promise<void> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const next = CONSENT_VALUES.includes(value) ? value : null;
  await prisma.contact.update({
    where: { id },
    data: { consent: next, consentAt: next ? new Date() : null },
  });
  await logAudit(prisma, {
    userId: session.userId,
    action: "CONSENT_SET",
    entity: "CONTACT",
    entityId: id,
    details: `consentement → ${next ?? "non renseigné"}`,
  });
  revalidatePath("/contacts");
}

/**
 * Droit à l'effacement: delete the contact and scrub its personal identifiers
 * from linked records. Business history (activity notes/bodies on the company
 * timeline) stays — only direct identifiers are removed: the contact row, its
 * email on activities, its pending-inbox rows, task/enrollment links.
 */
export async function eraseContact(id: string): Promise<RgpdResult> {
  const session = await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();

  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) return { error: "Contact introuvable." };
  const email = contact.email?.toLowerCase().trim();

  // Scrub the email from the contact's activities (sync would otherwise show it).
  await prisma.activity.updateMany({
    where: { contactId: id },
    data: { fromEmail: null, toEmail: null },
  });
  // Unlink tasks + enrollments (they keep working company-scoped).
  await prisma.task.updateMany({
    where: { contactId: id },
    data: { contactId: null },
  });
  await prisma.enrollment.updateMany({
    where: { contactId: id },
    data: { contactId: null },
  });
  // Drop inbox rows for this address, and block it so a future sync can't
  // silently recreate the person we just erased.
  if (email) {
    await prisma.pendingContact.deleteMany({ where: { email } });
    await prisma.blockedSender.upsert({
      where: { value: email },
      create: { value: email, kind: "EMAIL" },
      update: {},
    });
  }
  await prisma.contact.delete({ where: { id } });

  await logAudit(prisma, {
    userId: session.userId,
    action: "RGPD_ERASE",
    entity: "CONTACT",
    entityId: id,
    details: `effacement contact${email ? ` (${email})` : ""} — société ${contact.companyId}`,
  });

  revalidatePath("/contacts");
  revalidatePath(`/companies/${contact.companyId}`);
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { splitName, emailDomain } from "@/lib/email-sync";

/**
 * Approve a queued sender: create a Contact (optionally a new Company from the
 * email domain) and keep a note of the emails exchanged before approval.
 */
export async function approvePending(
  pendingId: string,
  companyId: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const pending = await prisma.pendingContact.findUnique({
    where: { id: pendingId },
  });
  if (!pending || pending.status !== "PENDING") return;

  let targetCompanyId = companyId;
  if (!companyId || companyId === "__new__") {
    const domain = emailDomain(pending.email) ?? pending.email;
    const company = await prisma.company.create({
      data: {
        nomSociete: domain,
        siret: `IMPORT-${pending.email}`,
        emailGenerique: pending.email,
        notes: "Société créée depuis la boîte de réception (à compléter).",
      },
    });
    targetCompanyId = company.id;
  }

  const { prenom, nom } = splitName(pending.name, pending.email);
  const contact = await prisma.contact.create({
    data: { companyId: targetCompanyId, email: pending.email, prenom, nom },
  });

  // Preserve the context of emails seen before this contact existed.
  await prisma.activity.create({
    data: {
      type: "EMAIL",
      direction: pending.direction,
      subject: pending.sampleSubject,
      note: `${pending.messageCount} email(s) échangé(s) avant l'ajout au CRM.`,
      date: pending.lastSeen,
      fromEmail: pending.email,
      contactId: contact.id,
      companyId: targetCompanyId,
    },
  });

  await prisma.pendingContact.update({
    where: { id: pendingId },
    data: { status: "APPROVED" },
  });

  revalidatePath("/inbox");
  revalidatePath("/contacts");
  revalidatePath(`/companies/${targetCompanyId}`);
}

export async function dismissPending(pendingId: string): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  await prisma.pendingContact.update({
    where: { id: pendingId },
    data: { status: "DISMISSED" },
  });
  revalidatePath("/inbox");
}

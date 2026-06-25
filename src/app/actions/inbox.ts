"use server";

import { revalidatePath } from "next/cache";
import type { PrismaClient } from "@prisma/client";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { splitName, emailDomain, isFreeDomain } from "@/lib/email-sync";

type PendingContact = NonNullable<
  Awaited<ReturnType<PrismaClient["pendingContact"]["findUnique"]>>
>;

/**
 * Turn a queued sender into a real Contact (optionally creating a Company from the
 * email domain), preserving a note of the emails exchanged before approval, and
 * mark the queue entry APPROVED. Shared by both "Approuver" and "Créer une tâche".
 */
async function promotePending(
  prisma: PrismaClient,
  pending: PendingContact,
  companyId: string,
): Promise<{ companyId: string; contactId: string }> {
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
    where: { id: pending.id },
    data: { status: "APPROVED" },
  });

  return { companyId: targetCompanyId, contactId: contact.id };
}

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

  const { companyId: cid } = await promotePending(prisma, pending, companyId);

  revalidatePath("/inbox");
  revalidatePath("/contacts");
  revalidatePath(`/companies/${cid}`);
}

const TASK_TYPES = ["RELANCE", "APPEL", "EMAIL", "RDV", "AUTRE"] as const;

/**
 * Promote a queued sender AND create a follow-up task on the resulting company —
 * the "Créer une tâche" action on an inbox row. Returns an error string for the
 * client to surface, or null on success.
 */
export async function createTaskFromPending(
  pendingId: string,
  companyId: string,
  input: { title: string; type: string; dueDate: string | null },
): Promise<string | null> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const pending = await prisma.pendingContact.findUnique({
    where: { id: pendingId },
  });
  if (!pending || pending.status !== "PENDING") return "Entrée déjà traitée.";

  const title = input.title.trim();
  if (!title) return "Intitulé requis.";
  const type = (TASK_TYPES as readonly string[]).includes(input.type)
    ? input.type
    : "RELANCE";
  let dueDate: Date | null = null;
  if (input.dueDate) {
    const d = new Date(input.dueDate);
    if (!Number.isNaN(d.getTime())) dueDate = d;
  }

  const { companyId: cid, contactId } = await promotePending(
    prisma,
    pending,
    companyId,
  );

  await prisma.task.create({
    data: {
      companyId: cid,
      contactId,
      title,
      type,
      dueDate,
      source: "MANUAL",
      userId: session.userId,
    },
  });

  revalidatePath("/inbox");
  revalidatePath("/contacts");
  revalidatePath("/todo");
  revalidatePath("/dashboard");
  revalidatePath(`/companies/${cid}`);
  return null;
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

/**
 * Mark a queued sender as spam: permanently block the address AND its domain (so
 * future mail from either never re-enters the CRM), and dismiss this entry plus
 * any other PENDING senders from the same domain.
 */
export async function markPendingSpam(pendingId: string): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const pending = await prisma.pendingContact.findUnique({
    where: { id: pendingId },
  });
  if (!pending) return;

  const email = pending.email.toLowerCase();
  const domain = emailDomain(email);
  const blockDomain = domain && !isFreeDomain(domain) ? domain : null;

  // Persist the block list entries the sync consults (idempotent).
  await prisma.blockedSender.upsert({
    where: { value: email },
    create: { value: email, kind: "EMAIL" },
    update: {},
  });
  if (blockDomain) {
    await prisma.blockedSender.upsert({
      where: { value: blockDomain },
      create: { value: blockDomain, kind: "DOMAIN" },
      update: {},
    });
  }

  // Clear it (and same-domain siblings) from the queue immediately.
  await prisma.pendingContact.updateMany({
    where: {
      status: "PENDING",
      OR: [
        { email },
        ...(blockDomain ? [{ email: { endsWith: `@${blockDomain}` } }] : []),
      ],
    },
    data: { status: "DISMISSED" },
  });

  revalidatePath("/inbox");
}

import type { PrismaClient } from "@prisma/client";

// The single gate deciding whether a company may receive automated cold email.
// Used by every enrollment entry point (fiche, bulk, Lead One auto-enroll) AND
// re-checked by the send engine right before each send — the world can change
// between enrollment and J+13 (opt-out, bounce, a reply on another thread).

export interface Recipient {
  email: string;
  contactId: string | null;
  prenom: string | null;
  nom: string | null;
}

export type EnrollCheck =
  | { ok: true; recipient: Recipient }
  | { ok: false; reason: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Pick who actually gets the emails: a decision-maker with a valid own email,
 * else any contact with one, else the company's generic address (most Lead One
 * prospects — the adaptive templates handle the missing first name).
 */
export async function resolveRecipient(
  prisma: PrismaClient,
  companyId: string,
  preferredContactId?: string | null,
): Promise<Recipient | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      contacts: {
        where: { email: { not: null } },
        orderBy: [{ isDecisionMaker: "desc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!company) return null;

  const usable = company.contacts.filter(
    (c) =>
      c.email &&
      EMAIL_RE.test(c.email) &&
      c.emailStatus !== "INVALID" &&
      c.consent !== "OPT_OUT",
  );
  const preferred = preferredContactId
    ? usable.find((c) => c.id === preferredContactId)
    : undefined;
  const contact = preferred ?? usable[0];
  if (contact?.email) {
    return {
      email: contact.email.toLowerCase(),
      contactId: contact.id,
      prenom: contact.prenom,
      nom: contact.nom,
    };
  }
  if (company.emailGenerique && EMAIL_RE.test(company.emailGenerique)) {
    return {
      email: company.emailGenerique.toLowerCase(),
      contactId: null,
      prenom: null,
      nom: null,
    };
  }
  return null;
}

/**
 * Full pre-flight check for enrolling `companyId` (or sending it the next
 * step). `forSend` skips the "already enrolled" guard — the send engine calls
 * this ON an active enrollment.
 */
export async function canEnroll(
  prisma: PrismaClient,
  companyId: string,
  opts: { preferredContactId?: string | null; forSend?: boolean } = {},
): Promise<EnrollCheck> {
  const recipient = await resolveRecipient(
    prisma,
    companyId,
    opts.preferredContactId,
  );
  if (!recipient) {
    return { ok: false, reason: "Aucune adresse email exploitable." };
  }

  const domain = recipient.email.split("@")[1] ?? "";
  const blocked = await prisma.blockedSender.findFirst({
    where: { value: { in: [recipient.email, domain] } },
  });
  if (blocked) {
    return { ok: false, reason: "Adresse ou domaine sur la liste bloquée (désinscrit)." };
  }

  if (!opts.forSend) {
    const existing = await prisma.enrollment.findFirst({
      where: {
        companyId,
        status: { in: ["ACTIVE", "PAUSED"] },
        sequence: { mode: "AUTO_EMAIL" },
      },
    });
    if (existing) {
      return { ok: false, reason: "Déjà inscrite dans une séquence d'envoi." };
    }
    // Someone who already replied once is a conversation, not a target.
    const replied = await prisma.enrollment.findFirst({
      where: { companyId, status: "REPLIED" },
    });
    if (replied) {
      return { ok: false, reason: "A déjà répondu à une séquence — à traiter à la main." };
    }
    const optedOut = await prisma.enrollment.findFirst({
      where: { companyId, status: "OPTED_OUT" },
    });
    if (optedOut) {
      return { ok: false, reason: "S'est désinscrite d'une précédente séquence." };
    }
  }

  return { ok: true, recipient };
}

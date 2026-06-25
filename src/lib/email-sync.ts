import type { PrismaClient } from "@prisma/client";
import { domainFromWebsite } from "./display";

// Core email→CRM logic, decoupled from IMAP so it can be unit-tested.
// Policy (chosen by the user): match emails to existing contacts; otherwise
// auto-create a contact when the sender's domain matches a known company;
// otherwise drop the address into a review queue (PendingContact).

export interface Addr {
  address: string;
  name?: string | null;
}

export interface ParsedEmail {
  messageId: string | null;
  date: Date;
  subject: string | null;
  from: Addr[];
  to: Addr[];
  cc: Addr[];
  snippet: string | null;
  body: string | null; // fuller plain-text body, for the AI insight pass
  bulk?: boolean; // header signature of a newsletter / mailing list / automated blast
}

export interface SyncOutcome {
  matched: number; // logged against an existing contact
  created: number; // new contact auto-created + logged
  pending: number; // queued for review
  filtered: number; // dropped as bulk/automated (kept out of the CRM)
}

// Free/consumer mail providers are never treated as a "company domain".
const FREE_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.fr",
  "hotmail.com",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.fr",
  "icloud.com",
  "me.com",
  "aol.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "bbox.fr",
  "numericable.fr",
  "protonmail.com",
  "proton.me",
]);

export function emailDomain(addr: string): string | null {
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const d = addr.slice(at + 1).toLowerCase().trim();
  return d || null;
}

// Mailbox local-parts that are machines, not people. Generic business addresses
// (contact@, info@, commercial@…) are deliberately NOT here — in brokerage
// prospecting those are real leads worth keeping.
const AUTOMATED_LOCALPARTS = new Set([
  "mailerdaemon",
  "postmaster",
  "bounce",
  "bounces",
  "mailer",
  "mdaemon",
  "notification",
  "notifications",
  "newsletter",
  "newsletters",
  "mailing",
  "mailings",
]);

/** True for no-reply / system / bulk-sender addresses that shouldn't become contacts. */
export function isAutomatedSender(address: string): boolean {
  const local = (address.split("@")[0] ?? "").toLowerCase();
  const compact = local.replace(/[._+-]/g, "");
  if (
    compact.includes("noreply") ||
    compact.includes("donotreply") ||
    compact.includes("notreply") ||
    compact.includes("nepasrepondre")
  ) {
    return true;
  }
  return AUTOMATED_LOCALPARTS.has(compact);
}

// Role/system words. A local-part containing one of these is a function or a
// machine ("calendar-notification", "cloud-manager-support"), not a person.
const ROLE_TOKENS = new Set([
  "notification", "notifications", "notify", "alert", "alerts",
  "support", "help", "service", "services", "feedback",
  "calendar", "cloud", "manager", "team", "admin", "billing",
  "invoice", "invoices", "payment", "payments", "order", "orders",
  "account", "accounts", "onboarding", "marketing", "news", "newsletter",
  "mail", "mailer", "mailing", "reply", "noreply", "no", "ne", "pas", "repondre",
  "contact", "info", "sales", "commercial", "hello", "hi", "do", "not",
]);

/**
 * A "prenom.nom"-shaped local-part — two alphabetic tokens, neither a role/system
 * word. A real person, so we never drop them on a stray bulk header alone (some
 * brokers email via tools that inject List-Unsubscribe). Automated/no-reply
 * addresses still get filtered: isSpamSender checks isAutomatedSender first.
 */
export function looksLikePerson(address: string): boolean {
  const tokens = (address.split("@")[0] ?? "")
    .toLowerCase()
    .split(/[._-]+/)
    .filter(Boolean);
  if (tokens.length < 2) return false;
  const alpha = (s: string) => /^[a-zàâäéèêëïîôöùûüçñ]{2,}$/i.test(s);
  const [a, b] = tokens;
  if (!alpha(a) || !alpha(b)) return false;
  return !ROLE_TOKENS.has(a) && !ROLE_TOKENS.has(b);
}

/**
 * The quality gate: a NEW (unknown) sender is spam if it's an automated/no-reply
 * address, or if the message is a bulk/marketing send AND the sender isn't a
 * named person. Such senders never become contacts or queue entries.
 */
export function isSpamSender(email: ParsedEmail, address: string): boolean {
  if (isAutomatedSender(address)) return true;
  return Boolean(email.bulk) && !looksLikePerson(address);
}

const norm = (a: string) => a.toLowerCase().trim();

/** Split a display name (or fall back to the email local-part) into prenom/nom. */
export function splitName(
  name: string | null | undefined,
  address: string,
): { prenom: string | null; nom: string | null } {
  const clean = (name ?? "").replace(/["']/g, "").trim();
  if (clean && /[a-zA-Z]/.test(clean)) {
    // "Dupont, Jean" → "Jean Dupont"
    const reordered = clean.includes(",")
      ? clean.split(",").map((s) => s.trim()).reverse().join(" ")
      : clean;
    const parts = reordered.split(/\s+/);
    if (parts.length === 1) return { prenom: parts[0], nom: null };
    return { prenom: parts[0], nom: parts.slice(1).join(" ") };
  }
  // Derive from local-part: "jean.dupont" → Jean Dupont
  const local = address.split("@")[0] ?? "";
  const tokens = local.split(/[._-]+/).filter(Boolean);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  if (tokens.length >= 2) return { prenom: cap(tokens[0]), nom: cap(tokens[1]) };
  if (tokens.length === 1) return { prenom: cap(tokens[0]), nom: null };
  return { prenom: null, nom: null };
}

export interface Caches {
  contactByEmail: Map<string, { contactId: string; companyId: string }>;
  companyByDomain: Map<string, string>;
}

export async function buildCaches(prisma: PrismaClient): Promise<Caches> {
  const contactByEmail = new Map<
    string,
    { contactId: string; companyId: string }
  >();
  const contacts = await prisma.contact.findMany({
    where: { email: { not: null } },
    select: { id: true, email: true, companyId: true },
  });
  for (const c of contacts) {
    if (c.email)
      contactByEmail.set(norm(c.email), {
        contactId: c.id,
        companyId: c.companyId,
      });
  }

  const companyByDomain = new Map<string, string>();
  const companies = await prisma.company.findMany({
    where: { OR: [{ siteWeb: { not: null } }, { emailGenerique: { not: null } }] },
    select: { id: true, siteWeb: true, emailGenerique: true },
  });
  for (const co of companies) {
    const domains = [
      domainFromWebsite(co.siteWeb),
      co.emailGenerique ? emailDomain(co.emailGenerique) : null,
    ];
    for (const d of domains) {
      if (d && !FREE_DOMAINS.has(d) && !companyByDomain.has(d)) {
        companyByDomain.set(d, co.id);
      }
    }
  }
  return { contactByEmail, companyByDomain };
}

async function logEmailActivity(
  prisma: PrismaClient,
  email: ParsedEmail,
  direction: string,
  ownerEmail: string,
  counterparty: string,
  contactId: string,
  companyId: string,
): Promise<boolean> {
  if (email.messageId) {
    const existing = await prisma.activity.findFirst({
      where: { messageId: email.messageId, contactId },
      select: { id: true },
    });
    if (existing) return false; // already imported
  }
  await prisma.activity.create({
    data: {
      type: "EMAIL",
      direction,
      subject: email.subject,
      note: email.snippet,
      body: email.body,
      date: email.date,
      fromEmail: direction === "OUTBOUND" ? ownerEmail : counterparty,
      toEmail: direction === "OUTBOUND" ? counterparty : ownerEmail,
      messageId: email.messageId,
      contactId,
      companyId,
    },
  });
  // Advance the company's "last contact" only forward in time.
  await prisma.company.updateMany({
    where: {
      id: companyId,
      OR: [{ dernierContact: null }, { dernierContact: { lt: email.date } }],
    },
    data: { dernierContact: email.date },
  });
  return true;
}

async function upsertPending(
  prisma: PrismaClient,
  cp: Addr,
  email: ParsedEmail,
  direction: string,
): Promise<boolean> {
  const address = norm(cp.address);
  const existing = await prisma.pendingContact.findUnique({ where: { email: address } });
  if (existing) {
    if (existing.status === "DISMISSED") return false; // respect prior dismissal
    await prisma.pendingContact.update({
      where: { email: address },
      data: {
        messageCount: { increment: 1 },
        lastSeen: email.date > existing.lastSeen ? email.date : existing.lastSeen,
        sampleSubject: existing.sampleSubject ?? email.subject,
        name: existing.name ?? cp.name ?? null,
        direction,
      },
    });
    return false;
  }
  await prisma.pendingContact.create({
    data: {
      email: address,
      name: cp.name ?? null,
      sampleSubject: email.subject,
      direction,
      firstSeen: email.date,
      lastSeen: email.date,
    },
  });
  return true;
}

export async function processEmail(
  prisma: PrismaClient,
  email: ParsedEmail,
  ownerEmail: string,
  caches: Caches,
): Promise<SyncOutcome> {
  const owner = norm(ownerEmail);
  const ownerIsSender = email.from.some((f) => norm(f.address) === owner);
  const direction = ownerIsSender ? "OUTBOUND" : "INBOUND";

  const raw = direction === "OUTBOUND" ? [...email.to, ...email.cc] : email.from;
  const seen = new Set<string>();
  const counterparties: Addr[] = [];
  for (const a of raw) {
    const address = norm(a.address || "");
    if (!address || address === owner || seen.has(address)) continue;
    seen.add(address);
    counterparties.push({ address, name: a.name ?? null });
  }

  const out: SyncOutcome = { matched: 0, created: 0, pending: 0, filtered: 0 };
  for (const cp of counterparties) {
    const match = caches.contactByEmail.get(cp.address);
    if (match) {
      const did = await logEmailActivity(
        prisma,
        email,
        direction,
        ownerEmail,
        cp.address,
        match.contactId,
        match.companyId,
      );
      if (did) out.matched++;
      continue;
    }

    // Quality gate: bulk/marketing mail and automated senders never enter the
    // CRM. Known contacts (matched above) are unaffected — only NEW senders.
    if (isSpamSender(email, cp.address)) {
      out.filtered++;
      continue;
    }

    const domain = emailDomain(cp.address);
    const companyId = domain ? caches.companyByDomain.get(domain) : undefined;
    if (companyId) {
      const { prenom, nom } = splitName(cp.name, cp.address);
      const contact = await prisma.contact.create({
        data: { companyId, email: cp.address, prenom, nom },
      });
      caches.contactByEmail.set(cp.address, { contactId: contact.id, companyId });
      await logEmailActivity(
        prisma,
        email,
        direction,
        ownerEmail,
        cp.address,
        contact.id,
        companyId,
      );
      out.created++;
      continue;
    }

    if (await upsertPending(prisma, cp, email, direction)) out.pending++;
  }
  return out;
}

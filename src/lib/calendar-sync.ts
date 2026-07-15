import type { PrismaClient } from "@prisma/client";
import type { IcsAttendee, IcsEvent } from "./ics";
import { emailDomain, splitName, type Caches } from "./email-sync";

// Calendar event matching/dedup engine, shared by google-calendar-sync.ts
// (OAuth). Matches attendees to known contacts/companies and logs a MEETING
// activity per event. Dedupe key is Activity.messageId = `cal:<event-uid>`.

export interface CalendarOutcome {
  events: number; // events considered (in window, not the owner's solo blocks)
  logged: number; // new MEETING activities created
  updated: number; // existing meetings whose time/subject changed
  unmatched: number; // events with no attendee matching a known company/contact
}

const DAY = 24 * 60 * 60 * 1000;

function peopleOf(ev: IcsEvent): IcsAttendee[] {
  const all = [...ev.attendees];
  if (ev.organizer) all.push(ev.organizer);
  return all;
}

async function resolveTarget(
  prisma: PrismaClient,
  people: IcsAttendee[],
  ownerEmail: string,
  caches: Caches,
): Promise<{ companyId: string; contactId: string | null } | null> {
  const owner = ownerEmail.toLowerCase();
  for (const p of people) {
    if (!p.email || p.email === owner) continue;
    const match = caches.contactByEmail.get(p.email);
    if (match) return { companyId: match.companyId, contactId: match.contactId };
  }
  // No known contact — try to attach to a company by sender domain, creating the
  // contact so future emails/meetings thread onto it.
  for (const p of people) {
    if (!p.email || p.email === owner) continue;
    const domain = emailDomain(p.email);
    const companyId = domain ? caches.companyByDomain.get(domain) : undefined;
    if (companyId) {
      const { prenom, nom } = splitName(p.name, p.email);
      const contact = await prisma.contact.create({
        data: { companyId, email: p.email, prenom, nom },
      });
      caches.contactByEmail.set(p.email, { contactId: contact.id, companyId });
      return { companyId, contactId: contact.id };
    }
  }
  return null;
}

export async function processCalendar(
  prisma: PrismaClient,
  events: IcsEvent[],
  ownerEmail: string,
  caches: Caches,
  opts: { windowDays?: number; dry?: boolean } = {},
): Promise<CalendarOutcome> {
  const windowDays = opts.windowDays ?? 90;
  const now = Date.now();
  const out: CalendarOutcome = { events: 0, logged: 0, updated: 0, unmatched: 0 };

  for (const ev of events) {
    if (!ev.start) continue;
    if (ev.status === "CANCELLED") continue;
    const age = now - ev.start.getTime();
    // Recent past + near future only — keeps the model/db work bounded.
    if (age > windowDays * DAY || age < -windowDays * DAY) continue;

    const people = peopleOf(ev);
    // Skip personal blocks with no external party.
    const hasOther = people.some(
      (p) => p.email && p.email !== ownerEmail.toLowerCase(),
    );
    if (!hasOther) continue;
    out.events++;

    const target = await resolveTarget(prisma, people, ownerEmail, caches);
    if (!target) {
      out.unmatched++;
      continue;
    }

    const messageId = `cal:${ev.uid}`;
    const note =
      [ev.description, ev.location ? `Lieu : ${ev.location}` : null]
        .filter(Boolean)
        .join("\n\n") || null;

    const existing = await prisma.activity.findFirst({
      where: { messageId },
      select: { id: true, subject: true, date: true },
    });

    if (existing) {
      const changed =
        existing.subject !== (ev.summary ?? null) ||
        existing.date.getTime() !== ev.start.getTime();
      if (changed && !opts.dry) {
        await prisma.activity.update({
          where: { id: existing.id },
          data: { subject: ev.summary, date: ev.start, body: note },
        });
        out.updated++;
      }
      continue;
    }

    if (!opts.dry) {
      await prisma.activity.create({
        data: {
          type: "MEETING",
          subject: ev.summary,
          note,
          body: note,
          date: ev.start,
          messageId,
          companyId: target.companyId,
          contactId: target.contactId,
        },
      });
      // A scheduled meeting is real engagement — advance last contact forward.
      await prisma.company.updateMany({
        where: {
          id: target.companyId,
          // `isSet:false` covers MongoDB docs with no dernierContact field (a
          // plain `: null` filter misses those on Mongo, so first contact never stamped).
          OR: [
            { dernierContact: { isSet: false } },
            { dernierContact: null },
            { dernierContact: { lt: ev.start } },
          ],
        },
        data: { dernierContact: ev.start },
      });
    }
    out.logged++;
  }
  return out;
}

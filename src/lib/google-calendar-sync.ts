import { google, type calendar_v3 } from "googleapis";
import type { PrismaClient } from "@prisma/client";
import { buildCaches } from "./email-sync";
import { processCalendar, type CalendarOutcome } from "./calendar-sync";
import type { IcsEvent, IcsAttendee } from "./ics";
import type { GoogleOAuthClient } from "./google-oauth";

// Google Calendar API sync (OAuth). Seamless replacement for the secret-iCal
// path in calendar-sync.ts: it lists events via the API, maps each into the
// existing IcsEvent shape, and runs the SAME matching/dedup/last-contact engine
// (processCalendar). Dedup key stays `cal:<iCalUID>` so switching a tenant from
// the ICS feed to OAuth never double-logs a meeting.
//
// Incremental via the API's syncToken (stored in SyncCursor("calendar")); a
// first run — or an expired token (HTTP 410) — falls back to a ±windowDays scan.

const CURSOR = "calendar";
const DAY = 24 * 60 * 60 * 1000;

function person(p?: calendar_v3.Schema$EventAttendee | calendar_v3.Schema$Event["organizer"]): IcsAttendee {
  return {
    email: p?.email ? p.email.toLowerCase() : null,
    name: p?.displayName ?? null,
  };
}

function toIcsEvent(ev: calendar_v3.Schema$Event): IcsEvent {
  const start = ev.start?.dateTime ?? ev.start?.date ?? null;
  const end = ev.end?.dateTime ?? ev.end?.date ?? null;
  return {
    uid: ev.iCalUID || ev.id || "",
    summary: ev.summary ?? null,
    description: ev.description ?? null,
    location: ev.location ?? null,
    start: start ? new Date(start) : null,
    end: end ? new Date(end) : null,
    organizer: ev.organizer ? person(ev.organizer) : null,
    attendees: (ev.attendees ?? []).map(person).filter((a) => a.email || a.name),
    status: ev.status ? ev.status.toUpperCase() : null, // confirmed|tentative|cancelled
  };
}

async function listEvents(
  calendar: calendar_v3.Calendar,
  syncToken: string | null,
  windowDays: number,
): Promise<{ events: calendar_v3.Schema$Event[]; nextSyncToken: string | null }> {
  const events: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId: "primary",
      singleEvents: true,
      maxResults: 250,
      pageToken,
    };
    if (syncToken) {
      params.syncToken = syncToken;
    } else {
      params.timeMin = new Date(Date.now() - windowDays * DAY).toISOString();
      params.timeMax = new Date(Date.now() + windowDays * DAY).toISOString();
    }
    const { data } = await calendar.events.list(params);
    for (const e of data.items ?? []) events.push(e);
    pageToken = data.nextPageToken ?? undefined;
    nextSyncToken = data.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}

export async function runGoogleCalendarSync(
  prisma: PrismaClient,
  client: GoogleOAuthClient,
  ownerEmail: string,
  opts: { windowDays?: number; dry?: boolean } = {},
): Promise<CalendarOutcome> {
  const windowDays = opts.windowDays ?? 90;
  const calendar = google.calendar({ version: "v3", auth: client });

  const state = await prisma.syncCursor.findUnique({ where: { source: CURSOR } });
  let syncToken = state?.cursor ?? null;

  let listed;
  try {
    listed = await listEvents(calendar, syncToken, windowDays);
  } catch (e) {
    // Expired/invalid syncToken → Google returns 410; restart with a full window.
    const status = (e as { code?: number; response?: { status?: number } }).code ??
      (e as { response?: { status?: number } }).response?.status;
    if (status !== 410) throw e;
    syncToken = null;
    listed = await listEvents(calendar, null, windowDays);
  }

  const caches = await buildCaches(prisma);
  const outcome = await processCalendar(
    prisma,
    listed.events.map(toIcsEvent),
    ownerEmail,
    caches,
    { windowDays, dry: opts.dry },
  );

  if (!opts.dry && listed.nextSyncToken) {
    const cursor = listed.nextSyncToken;
    await prisma.syncCursor.upsert({
      where: { source: CURSOR },
      create: { source: CURSOR, cursor },
      update: { cursor },
    });
  }

  return outcome;
}

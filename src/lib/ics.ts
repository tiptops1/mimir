// Minimal iCalendar (RFC 5545) parser — just enough to pull meetings out of a
// Google Calendar "secret address in iCal format" feed. No dependency, no OAuth.

export interface IcsAttendee {
  email: string | null;
  name: string | null;
}

export interface IcsEvent {
  uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start: Date | null;
  end: Date | null;
  organizer: IcsAttendee | null;
  attendees: IcsAttendee[];
  status: string | null; // CONFIRMED | TENTATIVE | CANCELLED
}

/** Unfold folded lines: a CRLF followed by space/tab continues the prior line. */
function unfold(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const out: string[] = [];
  for (const line of normalized.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Split "NAME;PARAM=x:VALUE" → { name, params, value }. */
function parseLine(line: string): {
  name: string;
  params: Record<string, string>;
  value: string;
} {
  const colon = line.indexOf(":");
  if (colon < 0) return { name: line, params: {}, value: "" };
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = left.split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Parse DTSTART/DTEND in the forms Google emits (UTC, floating, or date-only). */
function parseIcsDate(value: string, params: Record<string, string>): Date | null {
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === "Z") {
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  // TZID or floating: treat as UTC. Good enough for matching/last-contact dates.
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

function parsePerson(value: string, params: Record<string, string>): IcsAttendee {
  const email = value.replace(/^mailto:/i, "").trim().toLowerCase() || null;
  const name = params.CN ? params.CN.replace(/^"|"$/g, "") : null;
  return { email: email && email.includes("@") ? email : null, name };
}

export function parseIcs(raw: string): IcsEvent[] {
  const lines = unfold(raw);
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> & { attendees: IcsAttendee[] } = { attendees: [] };
  let inEvent = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      cur = { attendees: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (inEvent && cur.uid) {
        events.push({
          uid: cur.uid,
          summary: cur.summary ?? null,
          description: cur.description ?? null,
          location: cur.location ?? null,
          start: cur.start ?? null,
          end: cur.end ?? null,
          organizer: cur.organizer ?? null,
          attendees: cur.attendees,
          status: cur.status ?? null,
        });
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;

    const { name, params, value } = parseLine(line);
    switch (name) {
      case "UID":
        cur.uid = value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeText(value);
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(value);
        break;
      case "LOCATION":
        cur.location = unescapeText(value);
        break;
      case "STATUS":
        cur.status = value.trim().toUpperCase();
        break;
      case "DTSTART":
        cur.start = parseIcsDate(value.trim(), params);
        break;
      case "DTEND":
        cur.end = parseIcsDate(value.trim(), params);
        break;
      case "ORGANIZER":
        cur.organizer = parsePerson(value, params);
        break;
      case "ATTENDEE": {
        const a = parsePerson(value, params);
        if (a.email || a.name) cur.attendees.push(a);
        break;
      }
    }
  }
  return events;
}

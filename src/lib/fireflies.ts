import type { PrismaClient } from "@prisma/client";
import { buildCaches, emailDomain, splitName, type Caches } from "./email-sync";

// Fireflies.ai → CRM. Polls recent call transcripts via the Fireflies GraphQL
// API (free tier ships an API key + AI summary), matches meeting participants to
// known contacts/companies, and logs a CALL activity per transcript. The raw
// summary goes into `body` so the AI pass (ai-extract) can derive next steps.
// Dedupe key is Activity.messageId = `ff:<transcript-id>`.

const GQL_URL = "https://api.fireflies.ai/graphql";

interface FfAttendee {
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
}

interface FfTranscript {
  id: string;
  title?: string | null;
  date?: number | null; // epoch ms
  duration?: number | null; // minutes
  meeting_attendees?: FfAttendee[] | null;
  summary?: {
    overview?: string | null;
    action_items?: string | null;
    keywords?: string[] | null;
  } | null;
}

const LIST_QUERY = `
query Transcripts($limit: Int) {
  transcripts(limit: $limit) {
    id
    title
    date
    duration
    meeting_attendees { displayName name email }
    summary { overview action_items keywords }
  }
}`;

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(`Fireflies: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (!res.ok || !json.data) {
    throw new Error(`Fireflies API ${res.status}`);
  }
  return json.data;
}

export interface FirefliesOutcome {
  transcripts: number; // fetched from the API
  logged: number; // new CALL activities created
  unmatched: number; // no attendee matched a known company/contact
}

async function resolveTarget(
  prisma: PrismaClient,
  attendees: FfAttendee[],
  ownerEmail: string,
  caches: Caches,
): Promise<{ companyId: string; contactId: string | null } | null> {
  const owner = ownerEmail.toLowerCase();
  const norm = (a: FfAttendee) => (a.email || "").toLowerCase().trim();
  for (const a of attendees) {
    const email = norm(a);
    if (!email || email === owner) continue;
    const match = caches.contactByEmail.get(email);
    if (match) return { companyId: match.companyId, contactId: match.contactId };
  }
  for (const a of attendees) {
    const email = norm(a);
    if (!email || email === owner) continue;
    const domain = emailDomain(email);
    const companyId = domain ? caches.companyByDomain.get(domain) : undefined;
    if (companyId) {
      const { prenom, nom } = splitName(a.displayName || a.name, email);
      const contact = await prisma.contact.create({
        data: { companyId, email, prenom, nom },
      });
      caches.contactByEmail.set(email, { contactId: contact.id, companyId });
      return { companyId, contactId: contact.id };
    }
  }
  return null;
}

export async function syncFireflies(
  prisma: PrismaClient,
  opts: { apiKey?: string; ownerEmail?: string; limit?: number; dry?: boolean } = {},
): Promise<FirefliesOutcome> {
  const apiKey = opts.apiKey;
  const ownerEmail = (opts.ownerEmail || "").trim().toLowerCase();
  if (!apiKey) throw new Error("No Fireflies API key provided");

  const limit = opts.limit ?? 25;
  const { transcripts } = await gql<{ transcripts: FfTranscript[] }>(
    LIST_QUERY,
    { limit },
    apiKey,
  );

  const caches = await buildCaches(prisma);
  const out: FirefliesOutcome = {
    transcripts: transcripts.length,
    logged: 0,
    unmatched: 0,
  };

  for (const t of transcripts) {
    const messageId = `ff:${t.id}`;
    const existing = await prisma.activity.findFirst({
      where: { messageId },
      select: { id: true },
    });
    if (existing) continue;

    const attendees = t.meeting_attendees ?? [];
    const target = await resolveTarget(prisma, attendees, ownerEmail, caches);
    if (!target) {
      out.unmatched++;
      continue;
    }

    const overview = t.summary?.overview?.trim() || null;
    const actions = t.summary?.action_items?.trim() || null;
    const body =
      [overview, actions ? `Actions :\n${actions}` : null]
        .filter(Boolean)
        .join("\n\n") || null;
    const date = t.date ? new Date(t.date) : new Date();

    if (!opts.dry) {
      await prisma.activity.create({
        data: {
          type: "CALL",
          subject: t.title || "Appel (Fireflies)",
          note: overview,
          body,
          date,
          messageId,
          companyId: target.companyId,
          contactId: target.contactId,
        },
      });
      await prisma.company.updateMany({
        where: {
          id: target.companyId,
          // `isSet:false` covers Mongo docs with no dernierContact field (a plain
          // `: null` filter misses those on Mongo, so first contact never stamped).
          OR: [
            { dernierContact: { isSet: false } },
            { dernierContact: null },
            { dernierContact: { lt: date } },
          ],
        },
        data: { dernierContact: date },
      });
    }
    out.logged++;
  }
  return out;
}

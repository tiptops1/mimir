import { google } from "googleapis";
import type { PrismaClient } from "@prisma/client";
import {
  buildCaches,
  processEmail,
  expireStalePending,
  type SyncOutcome,
} from "./email-sync";
import { parseRawEmail } from "./mime-email";
import type { GoogleOAuthClient } from "./google-oauth";

// Gmail API email sync (OAuth). The seamless replacement for imap-sync.ts: it
// fetches messages in RAW form and feeds them through the SAME parser
// (mime-email) and matching engine (email-sync processEmail) as the IMAP path —
// only auth + transport differ.
//
// Incremental strategy: store the most recent message's internalDate (epoch ms)
// in SyncCursor("gmail") and next run query `after:<seconds>`. Day-granular
// overlap is harmless — processEmail dedupes by RFC Message-ID.

const CURSOR = "gmail";
const MAX_MESSAGES = 800; // bound work per run

export interface GmailSyncOptions {
  dry?: boolean;
  /** First-run lookback window in days when there's no cursor yet. */
  backfillDays?: number;
}

export interface GmailSyncResult extends SyncOutcome {
  scanned: number;
}

export async function runGmailSync(
  prisma: PrismaClient,
  client: GoogleOAuthClient,
  ownerEmail: string,
  opts: GmailSyncOptions = {},
): Promise<GmailSyncResult> {
  const gmail = google.gmail({ version: "v1", auth: client });

  const state = await prisma.syncCursor.findUnique({ where: { source: CURSOR } });
  const lastMs = state?.cursor ? Number.parseInt(state.cursor, 10) : null;

  // Exclude chats/drafts; either resume from the cursor or backfill a window.
  const q = lastMs
    ? `-in:chats -in:drafts after:${Math.floor(lastMs / 1000)}`
    : `-in:chats -in:drafts newer_than:${opts.backfillDays ?? 90}d`;

  // Collect message ids across pages (bounded).
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: 100,
      pageToken,
    });
    for (const m of data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < MAX_MESSAGES);

  const caches = await buildCaches(prisma);
  const totals: GmailSyncResult = {
    matched: 0,
    created: 0,
    pending: 0,
    filtered: 0,
    scanned: 0,
  };
  let maxMs = lastMs ?? 0;

  for (const id of ids) {
    const { data } = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "raw",
    });
    if (!data.raw) continue;
    totals.scanned++;
    const internalMs = data.internalDate ? Number.parseInt(data.internalDate, 10) : 0;
    if (internalMs > maxMs) maxMs = internalMs;

    if (!opts.dry) {
      const email = await parseRawEmail(Buffer.from(data.raw, "base64url"));
      const r = await processEmail(prisma, email, ownerEmail, caches);
      totals.matched += r.matched;
      totals.created += r.created;
      totals.pending += r.pending;
      totals.filtered += r.filtered;
    }
  }

  if (!opts.dry && maxMs > (lastMs ?? 0)) {
    const cursor = String(maxMs);
    await prisma.syncCursor.upsert({
      where: { source: CURSOR },
      create: { source: CURSOR, cursor },
      update: { cursor },
    });
  }

  // Queue maintenance: drop stale unhandled senders so the inbox stays fresh.
  if (!opts.dry) await expireStalePending(prisma);

  return totals;
}

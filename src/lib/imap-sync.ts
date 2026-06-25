import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { PrismaClient } from "@prisma/client";
import { buildCaches, processEmail, type SyncOutcome } from "./email-sync";
import { toParsedEmail } from "./mime-email";

// Gmail / Google Workspace email sync over IMAP (App Password auth). LEGACY path,
// kept as a fallback until the tenant connects via OAuth (see gmail-sync.ts).
// Reads IMAP_* and OWNER_EMAIL from the environment.

export interface ImapSyncOptions {
  dry?: boolean;
  backfill?: number;
}

export interface ImapSyncResult extends SyncOutcome {
  scanned: number;
  mailboxes: string[];
}

export async function runImapSync(
  prisma: PrismaClient,
  opts: ImapSyncOptions = {},
): Promise<ImapSyncResult> {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  const ownerEmail = (process.env.OWNER_EMAIL || user || "").trim();
  if (!host || !user || !pass) {
    throw new Error("Missing IMAP config (IMAP_HOST, IMAP_USER, IMAP_PASSWORD).");
  }

  const backfill = opts.backfill ?? 0;
  const client = new ImapFlow({
    host,
    port: Number.parseInt(process.env.IMAP_PORT ?? "993", 10),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const caches = await buildCaches(prisma);
  const totals: ImapSyncResult = {
    matched: 0,
    created: 0,
    pending: 0,
    filtered: 0,
    scanned: 0,
    mailboxes: [],
  };

  await client.connect();
  try {
    const boxes = await client.list();
    const sent = boxes.find((b) => b.specialUse === "\\Sent");
    const mailboxes = ["INBOX", sent?.path].filter(Boolean) as string[];
    totals.mailboxes = mailboxes;

    for (const mailbox of mailboxes) {
      const lock = await client.getMailboxLock(mailbox);
      try {
        const uidNext =
          typeof client.mailbox === "object" ? client.mailbox.uidNext : 0;
        const state = await prisma.emailSyncState.findUnique({
          where: { mailbox },
        });
        let lastUid = state?.lastUid ?? null;
        if (lastUid === null) {
          lastUid = backfill > 0 ? Math.max(0, uidNext - backfill - 1) : uidNext - 1;
        }

        let maxUid = lastUid;
        const range = `${lastUid + 1}:*`;
        for await (const msg of client.fetch(
          range,
          { uid: true, source: true },
          { uid: true },
        )) {
          if (msg.uid <= lastUid || !msg.source) continue;
          totals.scanned++;
          const parsed = await simpleParser(msg.source);
          const email = toParsedEmail(parsed);
          if (!opts.dry) {
            const r = await processEmail(prisma, email, ownerEmail, caches);
            totals.matched += r.matched;
            totals.created += r.created;
            totals.pending += r.pending;
            totals.filtered += r.filtered;
          }
          if (msg.uid > maxUid) maxUid = msg.uid;
        }

        if (!opts.dry && maxUid > (state?.lastUid ?? -1)) {
          await prisma.emailSyncState.upsert({
            where: { mailbox },
            create: { mailbox, lastUid: maxUid },
            update: { lastUid: maxUid },
          });
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return totals;
}

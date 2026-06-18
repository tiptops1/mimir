import "dotenv/config";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { PrismaClient } from "@prisma/client";
import {
  buildCaches,
  processEmail,
  type Addr,
  type ParsedEmail,
  type SyncOutcome,
} from "../src/lib/email-sync";

// Gmail/Workspace email sync over IMAP (App Password auth).
//
//   npm run sync:email                 -> incremental: only mail since last run
//   npm run sync:email -- --backfill=200  -> also import the last 200 messages/folder
//   npm run sync:email -- --dry        -> connect + parse but write nothing
//
// Env: IMAP_HOST, IMAP_PORT(=993), IMAP_USER, IMAP_PASSWORD (App Password),
//      OWNER_EMAIL (defaults to IMAP_USER).

const prisma = new PrismaClient();

function addrList(a: AddressObject | AddressObject[] | undefined): Addr[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  const out: Addr[] = [];
  for (const obj of arr) {
    for (const v of obj.value ?? []) {
      if (v.address) out.push({ address: v.address, name: v.name || null });
    }
  }
  return out;
}

function toParsedEmail(m: ParsedMail): ParsedEmail {
  const snippet = (m.text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280) || null;
  return {
    messageId: m.messageId ?? null,
    date: m.date ?? new Date(),
    subject: m.subject ?? null,
    from: addrList(m.from),
    to: addrList(m.to),
    cc: addrList(m.cc),
    snippet,
  };
}

async function main() {
  const dry = process.argv.includes("--dry");
  const backfillArg = process.argv.find((a) => a.startsWith("--backfill"));
  const backfill = backfillArg
    ? Number.parseInt(backfillArg.split("=")[1] ?? "200", 10) || 200
    : 0;

  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  const ownerEmail = (process.env.OWNER_EMAIL || user || "").trim();
  if (!host || !user || !pass) {
    console.error(
      "Missing IMAP config. Set IMAP_HOST, IMAP_USER, IMAP_PASSWORD (and OWNER_EMAIL).",
    );
    process.exit(1);
  }

  const client = new ImapFlow({
    host,
    port: Number.parseInt(process.env.IMAP_PORT ?? "993", 10),
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const caches = await buildCaches(prisma);
  const totals: SyncOutcome = { matched: 0, created: 0, pending: 0 };

  await client.connect();
  try {
    // Discover INBOX + the special-use Sent folder (name is localized on Gmail).
    const boxes = await client.list();
    const sent = boxes.find((b) => b.specialUse === "\\Sent");
    const mailboxes = ["INBOX", sent?.path].filter(Boolean) as string[];

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
          // First run: skip existing mail (going-forward) unless backfilling.
          lastUid = backfill > 0 ? Math.max(0, uidNext - backfill - 1) : uidNext - 1;
        }

        let maxUid = lastUid;
        let count = 0;
        const range = `${lastUid + 1}:*`;
        for await (const msg of client.fetch(
          range,
          { uid: true, source: true },
          { uid: true },
        )) {
          if (msg.uid <= lastUid || !msg.source) continue;
          count++;
          const parsed = await simpleParser(msg.source);
          const email = toParsedEmail(parsed);
          if (!dry) {
            const r = await processEmail(prisma, email, ownerEmail, caches);
            totals.matched += r.matched;
            totals.created += r.created;
            totals.pending += r.pending;
          }
          if (msg.uid > maxUid) maxUid = msg.uid;
        }

        if (!dry && maxUid > (state?.lastUid ?? -1)) {
          await prisma.emailSyncState.upsert({
            where: { mailbox },
            create: { mailbox, lastUid: maxUid },
            update: { lastUid: maxUid },
          });
        }
        console.log(
          `${mailbox}: scanned ${count} new message(s)${dry ? " [dry]" : ""}`,
        );
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  console.log(
    `${dry ? "[DRY] " : ""}Done. Logged ${totals.matched}, created ${totals.created} contact(s), ${totals.pending} queued for review.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

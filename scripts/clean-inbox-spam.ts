import "dotenv/config";
import { google } from "googleapis";
import { PrismaClient } from "@prisma/client";
import { parseRawEmail } from "../src/lib/mime-email";
import { isSpamSender } from "../src/lib/email-sync";
import { resolveTenant1Google } from "../src/lib/google-oauth";

// One-shot cleanup: re-scan recent Gmail and DISMISS any queued sender that is
// bulk/marketing mail or an automated address — the same quality gate the live
// sync now applies, but retroactively for the inbox built before the gate existed.
//
//   npm run clean:inbox -- --dry        preview only (writes nothing)
//   npm run clean:inbox                 dismiss the spam senders
//   npm run clean:inbox -- --days=180   widen the re-scan window (default 90)
//
// A sender is only dismissed if EVERY message seen from them is spam — anyone who
// also sent a genuine human email is left in the queue for review.

const MAX_MESSAGES = 1500;

async function main() {
  const dry = process.argv.includes("--dry");
  const daysArg = process.argv.find((a) => a.startsWith("--days"));
  const days = daysArg ? Number.parseInt(daysArg.split("=")[1] ?? "90", 10) || 90 : 90;

  const prisma = new PrismaClient();
  const googleAuth = await resolveTenant1Google();
  if (!googleAuth) {
    console.error("No Google connection for tenant #1 — cannot re-scan.");
    await prisma.$disconnect();
    process.exit(1);
  }
  const owner = googleAuth.accountEmail.toLowerCase();
  const gmail = google.gmail({ version: "v1", auth: googleAuth.client });

  // Page through message ids for the window (newest first).
  const q = `-in:chats -in:drafts newer_than:${days}d`;
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

  // Classify every counterparty address: spam unless we ever see a quality mail.
  const spamSeen = new Set<string>();
  const qualitySeen = new Set<string>();
  for (const id of ids) {
    const { data } = await gmail.users.messages.get({ userId: "me", id, format: "raw" });
    if (!data.raw) continue;
    const email = await parseRawEmail(Buffer.from(data.raw, "base64url"));
    // Mirror processEmail: counterparties are the sender (inbound) or the
    // recipients (outbound) — never attribute a blast's bulk flag to a bystander.
    const ownerIsSender = email.from.some((f) => (f.address || "").toLowerCase().trim() === owner);
    const raw = ownerIsSender ? [...email.to, ...email.cc] : email.from;
    const addrs = raw
      .map((a) => (a.address || "").toLowerCase().trim())
      .filter((a) => a && a !== owner);
    for (const addr of new Set(addrs)) {
      if (isSpamSender(email, addr)) spamSeen.add(addr);
      else qualitySeen.add(addr);
    }
  }

  const spamOnly = [...spamSeen].filter((a) => !qualitySeen.has(a));

  const targets = await prisma.pendingContact.findMany({
    where: { status: "PENDING", email: { in: spamOnly } },
    select: { email: true, name: true, messageCount: true },
  });

  console.log(
    `Scanned ${ids.length} message(s) over ${days}d → ${spamOnly.length} spam address(es); ` +
      `${targets.length} match the pending queue.`,
  );
  for (const t of targets) {
    console.log(`  ${dry ? "[DRY] " : ""}dismiss  ${t.email}  (${t.messageCount} msg)`);
  }

  if (!dry && targets.length > 0) {
    const r = await prisma.pendingContact.updateMany({
      where: { status: "PENDING", email: { in: targets.map((t) => t.email) } },
      data: { status: "DISMISSED" },
    });
    console.log(`Dismissed ${r.count} pending sender(s).`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

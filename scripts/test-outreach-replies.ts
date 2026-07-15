import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runOutreachSend } from "../src/lib/outreach/send-engine";
import {
  runOutreachReplySync,
  type GmailInboxApi,
} from "../src/lib/outreach/reply-sync";
import type { OutgoingEmail } from "../src/lib/gmail-send";
import type { GoogleOAuthClient } from "../src/lib/google-oauth";

/**
 * Reply/bounce sync + circuit-breaker probe (fake Gmail, real tenant DB).
 * Scenario: two enrollments send step 1 → one prospect replies (REPLIED +
 * task + alert + no follow-up), one bounces (BOUNCED + contact INVALID) →
 * forced bounce-rate breach trips the breaker on the next send run.
 *
 *   npx tsx scripts/test-outreach-replies.ts
 */

const SIRET_A = "00000000000002";
const SIRET_B = "00000000000003";

let failures = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  OK  ${label}`);
  else {
    failures++;
    console.error(`FAIL  ${label}`, detail ?? "");
  }
}

async function main() {
  const prisma = new PrismaClient();

  // ---------- fixtures ----------
  for (const siret of [SIRET_A, SIRET_B]) {
    const stale = await prisma.company.findUnique({ where: { siret } });
    if (stale) await prisma.company.delete({ where: { id: stale.id } });
  }
  await prisma.sequence.deleteMany({ where: { name: "PROBE REPLIES" } });
  await prisma.syncCursor.deleteMany({ where: { source: "outreach-inbox" } });

  const companyA = await prisma.company.create({
    data: { siret: SIRET_A, nomSociete: "PROBE Répondeur", emailGenerique: "alice@example.com" },
  });
  const companyB = await prisma.company.create({
    data: { siret: SIRET_B, nomSociete: "PROBE Bounce" },
  });
  const contactB = await prisma.contact.create({
    data: {
      companyId: companyB.id,
      prenom: "Bob",
      nom: "Broker",
      email: "bob@dead-domain.example.com",
    },
  });
  const sequence = await prisma.sequence.create({
    data: {
      name: "PROBE REPLIES",
      mode: "AUTO_EMAIL",
      active: true,
      steps: [
        { offsetDays: 0, channel: "EMAIL", title: "Accroche", subject: "Objet test", body: "Bonjour {{prenom}}," },
        { offsetDays: 3, channel: "EMAIL", title: "Relance", body: "Relance {{societe}}" },
      ],
    },
  });
  const enrA = await prisma.enrollment.create({
    data: { companyId: companyA.id, sequenceId: sequence.id, currentStep: 0, nextDueAt: new Date("2026-07-13T00:00:00Z"), status: "ACTIVE" },
  });
  const enrB = await prisma.enrollment.create({
    data: { companyId: companyB.id, sequenceId: sequence.id, contactId: contactB.id, currentStep: 0, nextDueAt: new Date("2026-07-13T00:00:00Z"), status: "ACTIVE" },
  });

  let n = 0;
  const outMails: OutgoingEmail[] = [];
  const fakeSend = async (_c: GoogleOAuthClient, email: OutgoingEmail) => {
    outMails.push(email);
    n++;
    return { messageId: `<pr-${n}@example.com>`, gmailId: `g${n}`, threadId: `t${n}` };
  };
  const outreach = { client: {} as GoogleOAuthClient, accountEmail: "outreach@example.com" };
  const mainBox = { client: {} as GoogleOAuthClient, accountEmail: "owner@example.com" };
  const monday = new Date("2026-07-13T08:00:00Z");

  // ---------- step 1 sends for both ----------
  const r1 = await runOutreachSend(prisma, "PROBE", outreach, {
    now: monday,
    sleepRange: [0, 0],
    send: fakeSend,
  });
  check("both step-1 emails sent", r1.sent === 2, r1);
  const msgs = await prisma.outreachMessage.findMany({
    where: { enrollmentId: { in: [enrA.id, enrB.id] } },
  });
  const msgA = msgs.find((m) => m.enrollmentId === enrA.id);
  const msgB = msgs.find((m) => m.enrollmentId === enrB.id);
  check("ledger rows for both", Boolean(msgA && msgB));

  // ---------- inbox: a human reply (thread A) + a bounce (thread B) ----------
  const inbox: GmailInboxApi = {
    async list() {
      return [{ id: "reply-1" }, { id: "bounce-1" }];
    },
    async get(id) {
      if (id === "reply-1") {
        return {
          threadId: msgA?.gmailThreadId ?? "t?",
          snippet: "Oui, ça m'intéresse — on peut s'appeler ?",
          payload: {
            headers: [
              { name: "From", value: "Alice Martin <alice@example.com>" },
              { name: "Subject", value: "Re: Objet test" },
              { name: "In-Reply-To", value: msgA?.messageId ?? "" },
              { name: "Message-ID", value: "<inbound-reply-1@example.com>" },
            ],
          },
        };
      }
      return {
        threadId: msgB?.gmailThreadId ?? "t?",
        snippet: "Address not found: bob@dead-domain.example.com",
        payload: {
          headers: [
            { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
            { name: "Subject", value: "Delivery Status Notification (Failure)" },
            { name: "In-Reply-To", value: msgB?.messageId ?? "" },
            { name: "Message-ID", value: "<bounce-ndr-1@googlemail.com>" },
          ],
        },
      };
    },
  };

  const alerts: OutgoingEmail[] = [];
  const alertSend = async (_c: GoogleOAuthClient, email: OutgoingEmail) => {
    alerts.push(email);
    return { messageId: "<alert-1@example.com>", gmailId: "ga", threadId: "ta" };
  };

  const sync = await runOutreachReplySync(prisma, outreach, mainBox, {
    now: new Date("2026-07-13T09:00:00Z"),
    gmailApi: inbox,
    send: alertSend,
  });
  check("sync scanned 2", sync.scanned === 2, sync);
  check("1 reply detected", sync.replies === 1, sync);
  check("1 bounce detected", sync.bounces === 1, sync);

  const afterA = await prisma.enrollment.findUnique({ where: { id: enrA.id } });
  check("A → REPLIED + no next step", afterA?.status === "REPLIED" && afterA?.nextDueAt === null);
  const afterB = await prisma.enrollment.findUnique({ where: { id: enrB.id } });
  check("B → BOUNCED", afterB?.status === "BOUNCED");
  const contactAfter = await prisma.contact.findUnique({ where: { id: contactB.id } });
  check("B contact email INVALID", contactAfter?.emailStatus === "INVALID");
  const msgBAfter = await prisma.outreachMessage.findUnique({ where: { id: msgB!.id } });
  check("B ledger row BOUNCED", msgBAfter?.status === "BOUNCED");
  const task = await prisma.task.findFirst({
    where: { companyId: companyA.id, source: "OUTREACH", done: false },
  });
  check("« Répondre » task created for A", Boolean(task), task?.title);
  const inboundAct = await prisma.activity.findFirst({
    where: { companyId: companyA.id, direction: "INBOUND", type: "EMAIL" },
  });
  check("INBOUND activity for A", Boolean(inboundAct));
  check("alert email sent to MAIN box", alerts.length === 1 && alerts[0].to === "owner@example.com", alerts[0]?.subject);
  check("alert names the company", (alerts[0]?.subject ?? "").includes("PROBE Répondeur"));

  // Re-run: cursor overlap must not duplicate anything.
  const sync2 = await runOutreachReplySync(prisma, outreach, mainBox, {
    now: new Date("2026-07-13T10:00:00Z"),
    gmailApi: inbox,
    send: alertSend,
  });
  check("re-run is idempotent", sync2.replies === 0 && sync2.bounces === 0, sync2);
  const tasksAfter = await prisma.task.count({
    where: { companyId: companyA.id, source: "OUTREACH" },
  });
  check("no duplicate task", tasksAfter === 1);

  // ---------- circuit breaker: 1 bounce / 2 sends = 50 % ≥ 5 %… needs sample ≥ 10.
  // Force it by injecting 9 extra SENT ledger rows → 1/11 bounced ≈ 9 % ≥ 5 %? No:
  // bounced=1, sent=11 → 9.1 % ≥ 5 % → trips. ----------
  for (let i = 0; i < 9; i++) {
    await prisma.outreachMessage.create({
      data: {
        enrollmentId: enrA.id,
        companyId: companyA.id,
        sequenceId: sequence.id,
        stepIndex: 0,
        toEmail: `filler${i}@example.com`,
        subject: "x",
        body: "x",
        messageId: `<filler-${i}@example.com>`,
        sentAt: new Date("2026-07-13T07:00:00Z"),
      },
    });
  }
  const enrC = await prisma.enrollment.create({
    data: { companyId: companyA.id, sequenceId: sequence.id, currentStep: 0, nextDueAt: new Date("2026-07-13T00:00:00Z"), status: "ACTIVE" },
  });
  const r2 = await runOutreachSend(prisma, "PROBE", outreach, {
    now: new Date("2026-07-13T12:00:00Z"),
    sleepRange: [0, 0],
    send: fakeSend,
  });
  check("breaker tripped on bounce rate", Boolean(r2.paused), r2);
  const cfg = await prisma.outreachConfig.findFirst();
  check("config paused with reason", cfg?.paused === true && Boolean(cfg?.pausedReason), cfg?.pausedReason);
  check("no mail went out while tripping", r2.sent === 0);

  // ---------- cleanup ----------
  await prisma.outreachConfig.updateMany({
    data: { paused: false, pausedReason: null, pausedAt: null },
  });
  await prisma.task.deleteMany({ where: { companyId: { in: [companyA.id, companyB.id] } } });
  await prisma.enrollment.deleteMany({ where: { id: { in: [enrA.id, enrB.id, enrC.id] } } });
  await prisma.company.delete({ where: { id: companyA.id } });
  await prisma.company.delete({ where: { id: companyB.id } });
  await prisma.sequence.delete({ where: { id: sequence.id } });
  await prisma.syncCursor.deleteMany({ where: { source: "outreach-inbox" } });
  await prisma.$disconnect();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

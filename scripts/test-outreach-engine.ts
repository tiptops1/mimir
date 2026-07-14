import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runOutreachSend } from "../src/lib/outreach/send-engine";
import {
  addBusinessDays,
  isBusinessDay,
  isWithinSendWindow,
  startOfParisDay,
  remainingRunsToday,
} from "../src/lib/outreach/business-days";
import type { OutgoingEmail } from "../src/lib/gmail-send";
import type { GoogleOAuthClient } from "../src/lib/google-oauth";

/**
 * Outreach engine probe — runs the WHOLE send pipeline against the real tenant
 * DB with a FAKE transport (no email leaves). Creates a throwaway company +
 * AUTO_EMAIL sequence + enrollment, drives three runs (send, cap-block,
 * follow-up threading), asserts ledger/activity/advancement, then cleans up.
 *
 *   npx tsx scripts/test-outreach-engine.ts
 */

const TEST_SIRET = "00000000000001";
const TEST_TENANT_ID = "PROBE_TENANT";

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

  // ---------- business-days unit checks (pure) ----------
  console.log("business-days:");
  // Tue 2026-07-14 = Bastille Day (holiday); 2026-07-11 = Saturday.
  check("saturday is not a business day", !isBusinessDay(new Date("2026-07-11T10:00:00Z")));
  check("bastille day is not a business day", !isBusinessDay(new Date("2026-07-14T10:00:00Z")));
  check("monday is a business day", isBusinessDay(new Date("2026-07-13T10:00:00Z")));
  // Easter Monday 2026 = April 6.
  check("easter monday 2026 skipped", !isBusinessDay(new Date("2026-04-06T10:00:00Z")));
  // Fri 2026-07-10 + 2 business days → Wed 15 (skips Sat, Sun, and Tue 14 July).
  const jump = addBusinessDays(new Date("2026-07-10T08:00:00Z"), 2);
  check(
    "Fri +2 business days skips weekend + holiday → Jul 15",
    jump.toISOString().startsWith("2026-07-15"),
    jump.toISOString(),
  );
  check(
    "send window contains 10:00 Paris",
    isWithinSendWindow(new Date("2026-07-13T08:00:00Z"), "09:00", "17:30"), // 10:00 Paris (UTC+2)
  );
  check(
    "send window excludes 07:00 Paris",
    !isWithinSendWindow(new Date("2026-07-13T05:00:00Z"), "09:00", "17:30"),
  );
  const sod = startOfParisDay(new Date("2026-07-13T12:00:00Z"));
  check(
    "start of Paris day = 22:00 UTC previous day (summer)",
    sod.toISOString() === "2026-07-12T22:00:00.000Z",
    sod.toISOString(),
  );
  check(
    "remainingRunsToday at 16:05 Paris with end 17:30 = 2",
    remainingRunsToday(new Date("2026-07-13T14:05:00Z"), "17:30") === 2,
  );

  // ---------- engine integration (fake transport) ----------
  console.log("send engine:");
  // Cleanup any prior aborted probe run first.
  const stale = await prisma.company.findUnique({ where: { siret: TEST_SIRET } });
  if (stale) await prisma.company.delete({ where: { id: stale.id } });
  await prisma.sequence.deleteMany({ where: { name: "PROBE — ne pas utiliser" } });

  const company = await prisma.company.create({
    data: {
      siret: TEST_SIRET,
      nomSociete: "PROBE Courtage",
      emailGenerique: "probe@example.com",
      siteWeb: "https://probe.example.com",
    },
  });
  const sequence = await prisma.sequence.create({
    data: {
      name: "PROBE — ne pas utiliser",
      mode: "AUTO_EMAIL",
      active: true,
      steps: [
        {
          offsetDays: 0,
          channel: "EMAIL",
          title: "Accroche",
          subject: "Test objet {{societe}}",
          body: "Bonjour {{prenom}},\n\nSociété {{societe}}. Site {{site}}.",
        },
        {
          offsetDays: 3,
          channel: "EMAIL",
          title: "Relance",
          body: "Bonjour {{prenom}},\n\nJe relance {{societe}}.",
        },
      ],
    },
  });
  const enrollment = await prisma.enrollment.create({
    data: {
      companyId: company.id,
      sequenceId: sequence.id,
      currentStep: 0,
      nextDueAt: new Date("2026-07-13T00:00:00Z"),
      status: "ACTIVE",
    },
  });

  const sentMails: OutgoingEmail[] = [];
  let sendCount = 0;
  const fakeSend = async (_client: GoogleOAuthClient, email: OutgoingEmail) => {
    sentMails.push(email);
    sendCount++;
    return {
      messageId: `<probe-${sendCount}@get-avelior.com>`,
      gmailId: `gm-${sendCount}`,
      threadId: "thread-1",
    };
  };
  const fakeOutreach = {
    client: {} as GoogleOAuthClient,
    accountEmail: "chris.toppo@get-avelior.com",
  };
  // Monday 2026-07-13 10:00 Paris — inside window, business day.
  const monday = new Date("2026-07-13T08:00:00Z");

  // Run 1: sends step 1.
  const r1 = await runOutreachSend(prisma, TEST_TENANT_ID, fakeOutreach, {
    now: monday,
    sleepRange: [0, 0],
    send: fakeSend,
  });
  check("run1 sent 1", r1.sent === 1, r1);
  const mail1 = sentMails[0];
  check("run1 to generic address", mail1?.to === "probe@example.com");
  check(
    "run1 subject rendered",
    mail1?.subject === "Test objet PROBE Courtage",
    mail1?.subject,
  );
  check(
    "run1 body: {{prenom}} collapsed ('Bonjour,')",
    (mail1?.body ?? "").startsWith("Bonjour,\n"),
    JSON.stringify(mail1?.body?.slice(0, 30)),
  );
  check(
    "run1 body has unsubscribe link",
    (mail1?.body ?? "").includes("/api/outreach/unsubscribe?t="),
  );
  check(
    "run1 List-Unsubscribe header",
    Boolean(mail1?.extraHeaders?.["List-Unsubscribe"]),
  );
  check("run1 no threading on first mail", !mail1?.inReplyTo && !mail1?.threadId);

  const after1 = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
  check("run1 advanced to step 1", after1?.currentStep === 1);
  check(
    "run1 next due at Paris midnight of Thu Jul 16 (J+3 ouvrés, holiday skipped)",
    after1?.nextDueAt?.toISOString() === "2026-07-15T22:00:00.000Z",
    after1?.nextDueAt?.toISOString(),
  );
  const ledger1 = await prisma.outreachMessage.findMany({
    where: { enrollmentId: enrollment.id },
  });
  check("run1 ledger row", ledger1.length === 1 && ledger1[0].gmailThreadId === "thread-1");
  const act1 = await prisma.activity.findMany({
    where: { companyId: company.id, type: "EMAIL", direction: "OUTBOUND" },
  });
  check("run1 OUTBOUND activity logged", act1.length === 1);
  const comp1 = await prisma.company.findUnique({ where: { id: company.id } });
  check(
    "run1 dernierContact bumped",
    comp1?.dernierContact?.getTime() === monday.getTime(),
  );

  // Run 2 (same day): step 2 not due → nothing sends.
  const r2 = await runOutreachSend(prisma, TEST_TENANT_ID, fakeOutreach, {
    now: monday,
    sleepRange: [0, 0],
    send: fakeSend,
  });
  check("run2 nothing due", r2.sent === 0, r2);

  // Run 3 (Thu 16 Jul): follow-up threads on the same conversation.
  const thursday = new Date("2026-07-16T08:00:00Z");
  const r3 = await runOutreachSend(prisma, TEST_TENANT_ID, fakeOutreach, {
    now: thursday,
    sleepRange: [0, 0],
    send: fakeSend,
  });
  check("run3 sent follow-up", r3.sent === 1, r3);
  const mail2 = sentMails[1];
  check(
    "run3 subject is Re: of step-1 subject",
    mail2?.subject === "Re: Test objet PROBE Courtage",
    mail2?.subject,
  );
  check(
    "run3 In-Reply-To = first messageId",
    mail2?.inReplyTo === "<probe-1@get-avelior.com>",
    mail2?.inReplyTo,
  );
  check(
    "run3 References carry the chain",
    (mail2?.references ?? []).join(" ") === "<probe-1@get-avelior.com>",
  );
  check("run3 same Gmail thread", mail2?.threadId === "thread-1");
  const after3 = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
  check("run3 sequence DONE after last step", after3?.status === "DONE" && after3?.nextDueAt === null);

  // Weekend guard: engine refuses to send on Saturday.
  const r4 = await runOutreachSend(prisma, TEST_TENANT_ID, fakeOutreach, {
    now: new Date("2026-07-18T09:00:00Z"),
    sleepRange: [0, 0],
    send: fakeSend,
  });
  check("saturday run idles", r4.idle === "Jour non ouvré", r4);

  // Daily cap: with cap forced to what's already sent today, nothing more goes.
  const cfg = await prisma.outreachConfig.findFirst();
  if (cfg) {
    await prisma.outreachConfig.update({
      where: { id: cfg.id },
      data: { dailyCap: 1 },
    });
  }
  const enrollment2 = await prisma.enrollment.create({
    data: {
      companyId: company.id,
      sequenceId: sequence.id,
      currentStep: 0,
      nextDueAt: new Date("2026-07-13T00:00:00Z"),
      status: "ACTIVE",
    },
  });
  const r5 = await runOutreachSend(prisma, TEST_TENANT_ID, fakeOutreach, {
    now: monday, // same Paris day as run 1 → 1 already sent, cap 1
    sleepRange: [0, 0],
    send: fakeSend,
  });
  check("cap reached → idle", (r5.idle ?? "").startsWith("Plafond quotidien"), r5);
  if (cfg) {
    await prisma.outreachConfig.update({
      where: { id: cfg.id },
      data: { dailyCap: 25 },
    });
  }

  // ---------- cleanup ----------
  await prisma.enrollment.deleteMany({
    where: { id: { in: [enrollment.id, enrollment2.id] } },
  });
  await prisma.company.delete({ where: { id: company.id } }); // cascades msgs/activities
  await prisma.sequence.delete({ where: { id: sequence.id } });
  await prisma.$disconnect();

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

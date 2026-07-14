import type { PrismaClient } from "@prisma/client";
import type { GoogleOAuthClient } from "@/lib/google-oauth";
import { sendGmail } from "@/lib/gmail-send";
import { parseSteps, type SequenceStep } from "@/lib/sequences";
import {
  addBusinessDays,
  isBusinessDay,
  isWithinSendWindow,
  remainingRunsToday,
  startOfParisDay,
} from "./business-days";
import {
  bounceBreakerReason,
  effectiveDailyCap,
  getOutreachConfig,
  isSpamOrQuotaError,
  pauseOutreach,
  sentToday,
} from "./guardrails";
import { canEnroll } from "./enroll";
import { renderTemplate } from "./template";
import { unsubscribeFooter, unsubscribeUrl } from "./unsubscribe";

// The cold-email send engine. Called hourly (business hours, Paris) per tenant
// by /api/cron/outreach. Owns AUTO_EMAIL enrollments end to end: renders the
// due step's template, sends from the OUTREACH inbox with reply-threading,
// records the ledger row + timeline Activity, and advances the enrollment in
// BUSINESS days. Non-email channels become Tasks (they cost no send budget).
// Every run re-checks the guardrails — pause flag, window, cap, bounce breaker.

const CHANNEL_TASK_TYPE: Record<string, string> = {
  APPEL: "APPEL",
  LINKEDIN: "AUTRE",
};

export interface SendRunReport {
  sent: number;
  tasks: number;
  completed: number;
  skipped: { enrollmentId: string; reason: string }[];
  errors: { enrollmentId: string; error: string }[];
  paused?: string;
  idle?: string;
}

interface SendOpts {
  now?: Date;
  fromName?: string | null;
  /** [min,max] ms pause between sends; tests pass [0,0]. */
  sleepRange?: [number, number];
  /** Injectable transport for tests/probes; defaults to the real Gmail send. */
  send?: typeof sendGmail;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "prenom.nom@x" → "Prenom Nom" — a human From name helps deliverability. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || email
  );
}

function subjectForStep(
  steps: SequenceStep[],
  index: number,
): { subject: string; isFollowUp: boolean } {
  const firstEmailIndex = steps.findIndex((s) => s.channel === "EMAIL");
  const first = steps[firstEmailIndex];
  const base = first?.subject?.trim() || "Prise de contact";
  if (index === firstEmailIndex) return { subject: base, isFollowUp: false };
  return { subject: `Re: ${base}`, isFollowUp: true };
}

export async function runOutreachSend(
  prisma: PrismaClient,
  tenantId: string,
  outreach: { client: GoogleOAuthClient; accountEmail: string } | null,
  opts: SendOpts = {},
): Promise<SendRunReport> {
  const now = opts.now ?? new Date();
  const report: SendRunReport = {
    sent: 0,
    tasks: 0,
    completed: 0,
    skipped: [],
    errors: [],
  };

  const config = await getOutreachConfig(prisma);
  if (config.paused) {
    report.paused = config.pausedReason ?? "En pause";
    return report;
  }
  if (!outreach) {
    report.idle = "Boîte d'envoi OUTREACH non connectée";
    return report;
  }
  if (!isBusinessDay(now, { skipHolidays: config.skipHolidays })) {
    report.idle = "Jour non ouvré";
    return report;
  }
  if (!isWithinSendWindow(now, config.sendWindowStart, config.sendWindowEnd)) {
    report.idle = "Hors de la fenêtre d'envoi";
    return report;
  }

  const breaker = await bounceBreakerReason(prisma, config, now);
  if (breaker) {
    await pauseOutreach(prisma, config, breaker);
    report.paused = breaker;
    return report;
  }

  const cap = effectiveDailyCap(config, now);
  const already = await sentToday(prisma, now);
  const remainingToday = cap - already;
  if (remainingToday <= 0) {
    report.idle = `Plafond quotidien atteint (${cap})`;
    return report;
  }
  // Spread the day's remaining budget over the remaining hourly runs, with a
  // little jitter so the volume-per-hour isn't metronomic.
  const runs = remainingRunsToday(now, config.sendWindowEnd);
  const budget = Math.min(
    remainingToday,
    Math.ceil(remainingToday / runs) + (Math.random() < 0.5 ? 0 : 1),
  );

  const due = await prisma.enrollment.findMany({
    where: {
      status: "ACTIVE",
      nextDueAt: { lte: now },
      sequence: { mode: "AUTO_EMAIL" },
    },
    include: { sequence: true, company: true },
    orderBy: { nextDueAt: "asc" },
    take: 100,
  });

  const [sleepMin, sleepMax] = opts.sleepRange ?? [5_000, 20_000];
  let sentThisRun = 0;

  for (const e of due) {
    if (sentThisRun >= budget) break;
    const steps = parseSteps(e.sequence.steps);
    const step = steps[e.currentStep];

    // Ran past the last step → the sequence ended without a reply.
    if (!step) {
      await prisma.enrollment.update({
        where: { id: e.id },
        data: { status: "DONE", nextDueAt: null },
      });
      report.completed++;
      continue;
    }

    const advance = async () => {
      const nextIndex = e.currentStep + 1;
      const next = steps[nextIndex];
      if (!next) {
        await prisma.enrollment.update({
          where: { id: e.id },
          data: { currentStep: nextIndex, status: "DONE", nextDueAt: null },
        });
        report.completed++;
        return;
      }
      // Anchor on the enrollment start and normalize to the target day's Paris
      // midnight — "J+3" means "due that business DAY"; the hourly budget then
      // decides the hour. If the cadence slipped (caps, pauses), still keep
      // ≥1 business day between touches.
      let dueNext = startOfParisDay(
        addBusinessDays(e.createdAt, next.offsetDays, {
          skipHolidays: config.skipHolidays,
        }),
      );
      if (dueNext <= now) {
        dueNext = startOfParisDay(
          addBusinessDays(now, 1, { skipHolidays: config.skipHolidays }),
        );
      }
      await prisma.enrollment.update({
        where: { id: e.id },
        data: { currentStep: nextIndex, nextDueAt: dueNext },
      });
    };

    // Non-email steps stay human: materialize a Task, consume no send budget.
    if (step.channel !== "EMAIL") {
      await prisma.task.create({
        data: {
          title: `${e.sequence.name} — ${step.title}`,
          type: CHANNEL_TASK_TYPE[step.channel] ?? "AUTRE",
          source: "SEQUENCE",
          dueDate: now,
          companyId: e.companyId,
          contactId: e.contactId ?? undefined,
        },
      });
      report.tasks++;
      await advance();
      continue;
    }

    // Re-check the world right before sending.
    const check = await canEnroll(prisma, e.companyId, {
      preferredContactId: e.contactId,
      forSend: true,
    });
    if (!check.ok) {
      const optedOut = /bloqué|désinscrit/i.test(check.reason);
      await prisma.enrollment.update({
        where: { id: e.id },
        data: {
          status: optedOut ? "OPTED_OUT" : "PAUSED",
          nextDueAt: null,
        },
      });
      report.skipped.push({ enrollmentId: e.id, reason: check.reason });
      continue;
    }
    const { recipient } = check;

    const vars = {
      prenom: recipient.prenom,
      nom: recipient.nom,
      societe: e.company.enseigne || e.company.nomSociete,
      site: e.company.siteWeb,
    };
    const subject = renderTemplate(
      subjectForStep(steps, e.currentStep).subject,
      vars,
    );
    const body =
      renderTemplate(step.body ?? "", vars) +
      unsubscribeFooter(tenantId, e.id, config.unsubscribeText);

    const prior = await prisma.outreachMessage.findMany({
      where: { enrollmentId: e.id },
      orderBy: { sentAt: "asc" },
      select: { messageId: true, gmailThreadId: true },
    });
    const last = prior[prior.length - 1];

    try {
      const doSend = opts.send ?? sendGmail;
      const sent = await doSend(outreach.client, {
        fromName: opts.fromName ?? nameFromEmail(outreach.accountEmail),
        fromEmail: outreach.accountEmail,
        to: recipient.email,
        subject,
        body,
        inReplyTo: last?.messageId ?? null,
        references: prior.map((m) => m.messageId),
        threadId: prior.find((m) => m.gmailThreadId)?.gmailThreadId ?? null,
        extraHeaders: {
          "List-Unsubscribe": `<${unsubscribeUrl(tenantId, e.id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      await prisma.outreachMessage.create({
        data: {
          enrollmentId: e.id,
          companyId: e.companyId,
          contactId: recipient.contactId,
          sequenceId: e.sequenceId,
          stepIndex: e.currentStep,
          toEmail: recipient.email,
          subject,
          body,
          messageId: sent.messageId,
          gmailMessageId: sent.gmailId,
          gmailThreadId: sent.threadId,
          sentAt: now,
        },
      });
      // Mirror as an OUTBOUND EMAIL Activity — same shape as the manual
      // composer (actions/email.ts) — so the fiche timeline stays whole.
      await prisma.activity.create({
        data: {
          companyId: e.companyId,
          contactId: recipient.contactId ?? undefined,
          type: "EMAIL",
          direction: "OUTBOUND",
          subject,
          body,
          toEmail: recipient.email,
          fromEmail: outreach.accountEmail,
          messageId: sent.messageId,
        },
      });
      await prisma.company.update({
        where: { id: e.companyId },
        data: { dernierContact: now },
      });

      report.sent++;
      sentThisRun++;
      await advance();

      if (sentThisRun < budget && sleepMax > 0) {
        await sleep(sleepMin + Math.random() * (sleepMax - sleepMin));
      }
    } catch (err) {
      if (isSpamOrQuotaError(err)) {
        const reason = `Erreur Gmail de type quota/spam : ${(err as Error).message}`;
        await pauseOutreach(prisma, config, reason);
        report.paused = reason;
        return report;
      }
      // Transient failure: leave the enrollment due; it retries next run.
      report.errors.push({ enrollmentId: e.id, error: (err as Error).message });
    }
  }

  return report;
}

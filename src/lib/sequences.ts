import type { PrismaClient } from "@prisma/client";

// Multi-touch cadence engine. A Sequence holds ordered steps; enrolling a company
// schedules the first step. Two modes (Sequence.mode):
//   TASKS      — the cron (advanceSequences) materializes each due step as a Task
//                in the worklist; a human actions it. The original behavior.
//   AUTO_EMAIL — the outreach send engine (lib/outreach/send-engine.ts) OWNS due
//                enrollments: EMAIL steps are sent automatically from the OUTREACH
//                inbox using the step's subject/body template; non-email channels
//                still become Tasks. advanceSequences skips these entirely.

export type SequenceChannel = "EMAIL" | "APPEL" | "LINKEDIN";
export type SequenceMode = "TASKS" | "AUTO_EMAIL";

export interface SequenceStep {
  offsetDays: number;
  channel: SequenceChannel;
  title: string;
  // AUTO_EMAIL templates ({{prenom}}, {{societe}}, … — see lib/outreach/template.ts).
  // Only the FIRST email step carries a subject; follow-ups thread as "Re:".
  subject?: string;
  body?: string;
}

const DAY = 86_400_000;

const CHANNEL_TASK_TYPE: Record<SequenceChannel, string> = {
  EMAIL: "EMAIL",
  APPEL: "APPEL",
  LINKEDIN: "AUTRE",
};

/** Parse/validate a Sequence.steps JSON value into typed steps. */
export function parseSteps(raw: unknown): SequenceStep[] {
  if (!Array.isArray(raw)) return [];
  const out: SequenceStep[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const offsetDays = typeof o.offsetDays === "number" ? o.offsetDays : 0;
    const channel: SequenceChannel =
      o.channel === "APPEL" || o.channel === "LINKEDIN" ? o.channel : "EMAIL";
    const title =
      typeof o.title === "string" && o.title.trim()
        ? o.title.trim()
        : "Action de séquence";
    const step: SequenceStep = { offsetDays, channel, title };
    if (typeof o.subject === "string" && o.subject.trim()) {
      step.subject = o.subject.trim();
    }
    if (typeof o.body === "string" && o.body.trim()) {
      step.body = o.body;
    }
    out.push(step);
  }
  return out;
}

/** Due date for the step at `index`, anchored on the enrollment start. */
export function dueAt(
  start: Date,
  steps: SequenceStep[],
  index: number,
): Date | null {
  const s = steps[index];
  if (!s) return null;
  return new Date(start.getTime() + s.offsetDays * DAY);
}

/**
 * Advance every ACTIVE enrollment whose current step is due: create the step's
 * Task, then schedule the next step (or mark the enrollment DONE).
 */
export async function advanceSequences(
  prisma: PrismaClient,
  opts: { now?: Date } = {},
): Promise<{ materialized: number; completed: number }> {
  const now = opts.now ?? new Date();
  // AUTO_EMAIL enrollments belong to the outreach send engine — materializing
  // their steps as tasks here would double-touch the prospect.
  const due = await prisma.enrollment.findMany({
    where: {
      status: "ACTIVE",
      nextDueAt: { lte: now },
      sequence: { mode: { not: "AUTO_EMAIL" } },
    },
    include: { sequence: true },
    take: 200,
  });

  let materialized = 0;
  let completed = 0;
  for (const e of due) {
    const steps = parseSteps(e.sequence.steps);
    const step = steps[e.currentStep];
    if (!step) {
      await prisma.enrollment.update({
        where: { id: e.id },
        data: { status: "DONE", nextDueAt: null },
      });
      completed++;
      continue;
    }

    await prisma.task.create({
      data: {
        title: `${e.sequence.name} — ${step.title}`,
        type: CHANNEL_TASK_TYPE[step.channel],
        source: "SEQUENCE",
        dueDate: now,
        companyId: e.companyId,
        contactId: e.contactId ?? undefined,
      },
    });
    materialized++;

    const nextIndex = e.currentStep + 1;
    const next = dueAt(e.createdAt, steps, nextIndex);
    await prisma.enrollment.update({
      where: { id: e.id },
      data: next
        ? { currentStep: nextIndex, nextDueAt: next }
        : { currentStep: nextIndex, status: "DONE", nextDueAt: null },
    });
    if (!next) completed++;
  }
  return { materialized, completed };
}

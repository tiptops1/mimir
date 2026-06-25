import type { PrismaClient } from "@prisma/client";

// Multi-touch cadence engine. A Sequence holds ordered steps; enrolling a company
// schedules the first step. The cron (advanceSequences) materializes each due step
// as a Task in the worklist and moves the enrollment forward. Auto-send is OFF by
// design — EMAIL steps create a task the user actions (one click to the AI
// composer), so nothing leaves the CRM without a human in the loop.

export type SequenceChannel = "EMAIL" | "APPEL" | "LINKEDIN";

export interface SequenceStep {
  offsetDays: number;
  channel: SequenceChannel;
  title: string;
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
    out.push({ offsetDays, channel, title });
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
  const due = await prisma.enrollment.findMany({
    where: { status: "ACTIVE", nextDueAt: { lte: now } },
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

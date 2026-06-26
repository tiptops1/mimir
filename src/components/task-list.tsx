"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Sparkles, Clock } from "lucide-react";
import { toggleTask, snoozeTask } from "@/app/actions/tasks";
import { TASK_TYPE_LABELS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui";

export interface TaskRow {
  id: string;
  title: string;
  type: string;
  dueDate: string | null; // ISO string
  source: string; // MANUAL | AI_NEXTSTEP
  company: { id: string; name: string } | null;
}

const SNOOZE = [
  { label: "Demain", days: 1 },
  { label: "+3 j", days: 3 },
  { label: "+1 sem.", days: 7 },
];

/** Color the due date by urgency (red overdue → amber soon → slate later). */
function dueStyle(dueIso: string | null): string {
  if (!dueIso) return "text-faint";
  const due = new Date(dueIso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "text-rose-600";
  if (days <= 1) return "text-amber-600";
  return "text-muted";
}

function TaskItem({ task }: { task: TaskRow }) {
  const [pending, startTransition] = useTransition();
  // Optimistically drop the row once completed — every list shows open tasks.
  const [done, setDone] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  if (done) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-white p-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setDone(true);
          startTransition(() => toggleTask(task.id, true));
        }}
        aria-label="Marquer comme fait"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-border-strong text-transparent transition-colors hover:border-emerald-500 hover:bg-emerald-500 hover:text-white disabled:opacity-50"
      >
        <Check className="h-3 w-3" />
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Badge className="bg-surface-2 text-muted">
            {TASK_TYPE_LABELS[task.type] ?? task.type}
          </Badge>
          {task.source === "AI_NEXTSTEP" && (
            <span className="inline-flex items-center gap-1 text-brand">
              <Sparkles className="h-3 w-3" /> IA
            </span>
          )}
          {task.company && (
            <Link
              href={`/companies/${task.company.id}`}
              className="text-brand hover:underline"
            >
              {task.company.name}
            </Link>
          )}
          <span className={dueStyle(task.dueDate)}>
            {task.dueDate ? formatDate(task.dueDate) : "Sans date"}
          </span>
        </div>
      </div>

      <div className="relative shrink-0">
        <button
          type="button"
          disabled={pending}
          onClick={() => setSnoozeOpen((v) => !v)}
          title="Reporter"
          className="rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
        >
          <Clock className="h-4 w-4" />
        </button>
        {snoozeOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border border-border bg-white p-1.5 shadow-lg">
            {SNOOZE.map((s) => (
              <button
                key={s.days}
                type="button"
                onClick={() => {
                  setSnoozeOpen(false);
                  startTransition(() => snoozeTask(task.id, s.days));
                }}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TaskList({
  tasks,
  empty = "Aucune tâche.",
}: {
  tasks: TaskRow[];
  empty?: string;
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <TaskItem key={t.id} task={t} />
      ))}
    </div>
  );
}

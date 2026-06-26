"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import type { NotificationSummary } from "@/lib/notifications";

// Header bell: a badge of what needs attention now (overdue/today tasks +
// prospects to relance), with a dropdown listing the top items.
export function NotificationsBell({ summary }: { summary: NotificationSummary }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const badge = summary.total > 9 ? "9+" : String(summary.total);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white text-muted hover:bg-surface-2"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {summary.total > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
          <div className="border-b border-border px-4 py-2.5 text-sm font-semibold">
            À traiter
            <span className="ml-2 text-xs font-normal text-muted">
              {summary.taskCount} tâche{summary.taskCount > 1 ? "s" : ""} ·{" "}
              {summary.staleCount} à relancer
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {summary.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                Rien d&apos;urgent. 🎉
              </p>
            ) : (
              summary.items.map((it) => (
                <Link
                  key={it.id}
                  href={it.href}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2.5 hover:bg-surface-2"
                >
                  <p className="truncate text-sm font-medium">{it.label}</p>
                  <p className="text-xs text-muted">{it.sub}</p>
                </Link>
              ))
            )}
          </div>
          <Link
            href="/todo"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-brand hover:bg-surface-2"
          >
            Voir toutes les tâches
          </Link>
        </div>
      )}
    </div>
  );
}

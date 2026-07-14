"use client";

import { useTransition } from "react";
import { OctagonAlert, Play, RefreshCw } from "lucide-react";
import { resumeOutreach } from "@/app/actions/outreach";

// Red banner shown on /outreach and /dashboard while the send engine is
// paused (circuit breaker or manual). Resuming is deliberately a human act —
// the breaker exists to force someone to LOOK before more mail goes out.

export function OutreachPausedBanner({
  reason,
  pausedAt,
  canResume,
}: {
  reason: string | null;
  pausedAt: string | null;
  canResume: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-red-300 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-red-900 dark:bg-red-950/40">
      <div className="flex items-start gap-3">
        <OctagonAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div>
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Envois cold email en pause
          </p>
          <p className="text-sm text-red-700 dark:text-red-400">
            {reason ?? "Mise en pause."}
            {pausedAt ? ` (depuis le ${pausedAt})` : ""}
          </p>
        </div>
      </div>
      {canResume && (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => void resumeOutreach())}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-red-300 bg-card px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
        >
          {pending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Reprendre les envois
        </button>
      )}
    </div>
  );
}

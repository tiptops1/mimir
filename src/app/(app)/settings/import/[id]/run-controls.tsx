"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { commitImport, runDryRun } from "@/app/actions/import";
import { Button } from "@/components/ui";

// Step controls: dry run from MAPPED, commit from DRY_RUN_DONE (or re-commit
// from DONE — idempotent, converges to zero new writes on the same file).

export function RunControls({ runId, status }: { runId: string; status: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const launch = (fn: (id: string) => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn(runId);
      if (result.error) setError(result.error);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {["MAPPED", "FAILED"].includes(status) && (
        <Button onClick={() => launch(runDryRun)} disabled={pending}>
          {pending ? "Lancement…" : "Lancer la simulation"}
        </Button>
      )}
      {status === "DRY_RUN_DONE" && (
        <>
          <Button onClick={() => launch(commitImport)} disabled={pending}>
            {pending ? "Lancement…" : "Confirmer l'import"}
          </Button>
          <Button variant="secondary" onClick={() => launch(runDryRun)} disabled={pending}>
            Relancer la simulation
          </Button>
        </>
      )}
      {status === "DONE" && (
        <Button variant="secondary" onClick={() => launch(commitImport)} disabled={pending}>
          Relancer l&apos;import (idempotent)
        </Button>
      )}
      {["MAPPED", "DRY_RUN_DONE"].includes(status) && (
        <Link
          href={`/settings/import/${runId}?edit=1`}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-foreground"
        >
          Revoir le mapping
        </Link>
      )}
      {error && (
        <p className="w-full rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

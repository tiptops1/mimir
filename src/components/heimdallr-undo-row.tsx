"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { undoActionSA } from "@/app/actions/heimdallr";

export function HeimdallrUndoButton({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const err = await undoActionSA(id);
            if (err) setError(err);
          })
        }
      >
        Annuler
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

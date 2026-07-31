"use client";

import { useActionState, useState, useTransition } from "react";
import { Trash2, X } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import {
  deactivateWatchSA,
  rejectCandidateSA,
  upsertWatchSA,
  type SourcingActionResult,
} from "@/app/actions/chronos-sourcing";

/** Add a reference to the watchlist, or retune the one already there. */
export function WatchForm({
  refs,
}: {
  refs: Array<{ id: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState<
    SourcingActionResult | undefined,
    FormData
  >(upsertWatchSA, undefined);
  const [open, setOpen] = useState(false);

  // No auto-close effect: closing the form from inside an effect is a
  // synchronous setState during render commit (and lints as one). The saved row
  // appears in the table below via revalidatePath, which is the real
  // confirmation — the form just says so and stays put for a second entry.
  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Suivre une référence
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="refId">Référence</Label>
          <select
            id="refId"
            name="refId"
            required
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          >
            {refs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="refurbCost">Coût de restauration typique (€)</Label>
          <Input id="refurbCost" name="refurbCost" type="number" min="0" step="1" placeholder="0" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="maxPricePct">Plafond (% de la médiane vendue)</Label>
          <Input id="maxPricePct" name="maxPricePct" type="number" min="1" max="100" step="1" placeholder="facultatif" />
        </div>
        <div>
          <Label htmlFor="note">Note</Label>
          <Input id="note" name="note" placeholder="facultatif" />
        </div>
      </div>
      <p className="text-[11px] text-faint">
        Le plafond ne peut que <strong>durcir</strong> le calcul de marge, jamais l&apos;assouplir :
        c&apos;est toujours le plus strict des deux qui s&apos;applique.
      </p>
      {state?.error ? <p className="text-xs text-danger">{state.error}</p> : null}
      {state?.ok ? <p className="text-xs text-success">{state.message}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Enregistrement…" : "Suivre"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>
    </form>
  );
}

export function DeactivateWatchButton({ refId }: { refId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(async () => void (await deactivateWatchSA(refId)))}
    >
      <Trash2 className="h-3.5 w-3.5" />
      Ne plus suivre
    </Button>
  );
}

export function RejectCandidateButton({ candidateId }: { candidateId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(async () => void (await rejectCandidateSA(candidateId)))}
    >
      <X className="h-3.5 w-3.5" />
      Écarter
    </Button>
  );
}

"use client";

import { useActionState, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import {
  deactivatePersonSA,
  deleteWorkLogSA,
  logWorkSA,
  upsertPersonSA,
  type WorkActionResult,
} from "@/app/actions/chronos-work";

const KIND_OPTIONS = [
  { value: "EMPLOYEE", label: "Salarié" },
  { value: "CONTRACTOR", label: "Prestataire" },
  { value: "SELF", label: "Vous-même" },
];

export function PersonForm() {
  const [state, formAction, pending] = useActionState<WorkActionResult | undefined, FormData>(
    upsertPersonSA,
    undefined,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Ajouter un intervenant
      </Button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="name">Nom</Label>
          <Input id="name" name="name" required placeholder="Prénom Nom" />
        </div>
        <div>
          <Label htmlFor="kind">Type</Label>
          <select
            id="kind"
            name="kind"
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="hourlyRate">Taux horaire (€)</Label>
          <Input id="hourlyRate" name="hourlyRate" placeholder="taux de l'atelier si vide" />
        </div>
      </div>
      <div>
        <Label htmlFor="note">Note</Label>
        <Input id="note" name="note" placeholder="facultatif" />
      </div>
      {state?.error ? <p className="text-xs text-danger">{state.error}</p> : null}
      {state?.ok ? <p className="text-xs text-success">{state.message}</p> : null}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Fermer
        </Button>
      </div>
    </form>
  );
}

export function LogWorkForm({
  people,
  units,
}: {
  people: Array<{ id: string; name: string }>;
  units: Array<{ id: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState<WorkActionResult | undefined, FormData>(
    logWorkSA,
    undefined,
  );

  if (people.length === 0 || units.length === 0) {
    return (
      <p className="text-sm text-muted">
        Ajoutez au moins un intervenant et gardez une montre en stock pour pouvoir saisir du temps.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="personId">Intervenant</Label>
          <select
            id="personId"
            name="personId"
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="unitId">Montre</Label>
          <select
            id="unitId"
            name="unitId"
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="duration">Durée</Label>
          <Input id="duration" name="duration" required placeholder="1h30, 90m, 90" />
        </div>
        <div>
          <Label htmlFor="performedAt">Date</Label>
          <Input id="performedAt" name="performedAt" type="date" />
        </div>
      </div>
      <div>
        <Label htmlFor="note">Note</Label>
        <Input id="note" name="note" placeholder="ex : remontoir, polissage boîtier" />
      </div>
      {state?.error ? <p className="text-xs text-danger">{state.error}</p> : null}
      {state?.ok ? <p className="text-xs text-success">{state.message}</p> : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Enregistrement…" : "Enregistrer le temps"}
      </Button>
    </form>
  );
}

export function DeactivatePersonButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(async () => void (await deactivatePersonSA(id)))}
    >
      Désactiver
    </Button>
  );
}

export function DeleteWorkLogButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => startTransition(async () => void (await deleteWorkLogSA(id)))}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

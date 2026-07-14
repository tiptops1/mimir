"use client";

import { useActionState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import {
  saveOutreachConfig,
  type OutreachActionResult,
} from "@/app/actions/outreach";

// Editor for OutreachConfig — the singleton driving daily cap, warm-up ramp,
// send window, holiday skip, bounce breaker threshold, unsubscribe footer, and
// the Lead One auto-enroll target. ADMIN-only in the action; the form here
// stays visible so non-admins can see the current settings.

export interface OutreachConfigFormInitial {
  dailyCap: number;
  rampStartDate: string; // "YYYY-MM-DD" or ""
  rampStartCap: number;
  rampWeeklyIncrement: number;
  sendWindowStart: string;
  sendWindowEnd: string;
  skipHolidays: boolean;
  bounceThresholdPct: number;
  autoEnrollSequenceId: string;
  unsubscribeText: string;
}

export function OutreachConfigForm({
  initial,
  sequences,
}: {
  initial: OutreachConfigFormInitial;
  sequences: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<
    OutreachActionResult | undefined,
    FormData
  >(saveOutreachConfig, undefined);

  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="dailyCap">Plafond quotidien (envois/jour)</Label>
          <Input
            id="dailyCap"
            name="dailyCap"
            type="number"
            min={1}
            max={200}
            defaultValue={initial.dailyCap}
          />
        </div>
        <div>
          <Label htmlFor="bounceThresholdPct">Seuil d&apos;alerte bounce (%)</Label>
          <Input
            id="bounceThresholdPct"
            name="bounceThresholdPct"
            type="number"
            min={1}
            max={50}
            defaultValue={initial.bounceThresholdPct}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Chauffe (warm-up)
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="rampStartDate">Début de chauffe</Label>
            <Input
              id="rampStartDate"
              name="rampStartDate"
              type="date"
              defaultValue={initial.rampStartDate}
            />
          </div>
          <div>
            <Label htmlFor="rampStartCap">Plafond semaine 1</Label>
            <Input
              id="rampStartCap"
              name="rampStartCap"
              type="number"
              min={1}
              max={50}
              defaultValue={initial.rampStartCap}
            />
          </div>
          <div>
            <Label htmlFor="rampWeeklyIncrement">+/semaine</Label>
            <Input
              id="rampWeeklyIncrement"
              name="rampWeeklyIncrement"
              type="number"
              min={1}
              max={50}
              defaultValue={initial.rampWeeklyIncrement}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">
          Vide = pas de chauffe (le plafond quotidien s&apos;applique directement).
        </p>
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Fenêtre d&apos;envoi (Europe/Paris)
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="sendWindowStart">Début</Label>
            <Input
              id="sendWindowStart"
              name="sendWindowStart"
              type="time"
              defaultValue={initial.sendWindowStart}
            />
          </div>
          <div>
            <Label htmlFor="sendWindowEnd">Fin</Label>
            <Input
              id="sendWindowEnd"
              name="sendWindowEnd"
              type="time"
              defaultValue={initial.sendWindowEnd}
            />
          </div>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="skipHolidays"
            defaultChecked={initial.skipHolidays}
            className="h-4 w-4 rounded border-border"
          />
          Sauter les jours fériés français
        </label>
      </div>

      <div>
        <Label htmlFor="autoEnrollSequenceId">
          Auto-inscription Lead One (facultatif)
        </Label>
        <Select
          id="autoEnrollSequenceId"
          name="autoEnrollSequenceId"
          defaultValue={initial.autoEnrollSequenceId}
        >
          <option value="">— Aucune —</option>
          {sequences.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <p className="mt-1 text-xs text-muted">
          Chaque société approuvée depuis /leadone est inscrite dans cette séquence
          (si son adresse email est exploitable).
        </p>
      </div>

      <div>
        <Label htmlFor="unsubscribeText">Phrase du lien de désinscription</Label>
        <Input
          id="unsubscribeText"
          name="unsubscribeText"
          defaultValue={initial.unsubscribeText}
        />
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {state?.ok && <span className="text-sm text-emerald-700">Enregistré.</span>}
        {state?.error && <span className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  );
}

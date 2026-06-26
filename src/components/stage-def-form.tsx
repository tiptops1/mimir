"use client";

import { useActionState, useEffect } from "react";
import {
  createStageDef,
  updateStageDef,
  type StageConfigResult,
} from "@/app/actions/stage-config";
import { Button, Input, Label } from "@/components/ui";
import type { StageDef } from "@/lib/stage-meta";

export function StageDefForm({
  def,
  onDone,
}: {
  def?: StageDef & { id: string };
  onDone?: () => void;
}) {
  const isEdit = Boolean(def);
  const action = isEdit ? updateStageDef.bind(null, def!.id) : createStageDef;
  const [state, formAction, pending] = useActionState<
    StageConfigResult | undefined,
    FormData
  >(action, undefined);

  // Only close the form on success — closing unconditionally would hide a
  // validation error (e.g. duplicate key) returned by the action.
  useEffect(() => {
    if (state?.ok) onDone?.();
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="key">Clé</Label>
          <Input
            id="key"
            name="key"
            defaultValue={def?.value}
            disabled={isEdit}
            placeholder="ex: EN_NEGOCIATION"
            required
          />
        </div>
        <div>
          <Label htmlFor="label">Libellé</Label>
          <Input id="label" name="label" defaultValue={def?.label} required />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="accentClass">Classe accent (bord)</Label>
          <Input
            id="accentClass"
            name="accentClass"
            defaultValue={def?.accent}
            placeholder="border-t-slate-400"
          />
        </div>
        <div>
          <Label htmlFor="badgeClass">Classe badge</Label>
          <Input
            id="badgeClass"
            name="badgeClass"
            defaultValue={def?.badge}
            placeholder="bg-surface-2 text-foreground"
          />
        </div>
        <div>
          <Label htmlFor="dotClass">Classe pastille</Label>
          <Input
            id="dotClass"
            name="dotClass"
            defaultValue={def?.dot}
            placeholder="bg-slate-400"
          />
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isWon"
            defaultChecked={def?.isWon}
            className="h-4 w-4 accent-[var(--brand)]"
          />
          Étape gagnée
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="isLost"
            defaultChecked={def?.isLost}
            className="h-4 w-4 accent-[var(--brand)]"
          />
          Étape perdue
        </label>
      </div>

      {state?.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : isEdit ? "Mettre à jour" : "Ajouter l'étape"}
        </Button>
        {onDone && (
          <Button type="button" variant="secondary" onClick={onDone}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

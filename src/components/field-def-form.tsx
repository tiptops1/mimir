"use client";

import { useActionState, useEffect } from "react";
import {
  createFieldDef,
  updateFieldDef,
  type FieldConfigResult,
} from "@/app/actions/field-config";
import { Button, Input, Label, Select } from "@/components/ui";
import type { ConfigEntity, FieldDef } from "@/lib/field-config";

const TYPE_LABELS: Record<string, string> = {
  text: "Texte",
  number: "Nombre",
  select: "Liste déroulante",
  bool: "Case à cocher",
  date: "Date",
};

export function FieldDefForm({
  entity,
  def,
  onDone,
}: {
  entity: ConfigEntity;
  def?: FieldDef & { id: string };
  onDone?: () => void;
}) {
  const isEdit = Boolean(def);
  const isNative = def?.source === "NATIVE";
  const action = isEdit
    ? updateFieldDef.bind(null, def!.id)
    : createFieldDef;
  const [state, formAction, pending] = useActionState<
    FieldConfigResult | undefined,
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
      {!isEdit && <input type="hidden" name="entity" value={entity} />}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="key">Clé</Label>
          <Input
            id="key"
            name="key"
            defaultValue={def?.key}
            disabled={isEdit}
            placeholder="ex: logicielGestion"
            required
          />
        </div>
        <div>
          <Label htmlFor="label">Libellé</Label>
          <Input id="label" name="label" defaultValue={def?.label} required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="section">Section</Label>
          <Input
            id="section"
            name="section"
            defaultValue={def?.section}
            placeholder="ex: Qualification"
          />
        </div>
        <div>
          <Label htmlFor="type">Type</Label>
          <Select
            id="type"
            name="type"
            defaultValue={def?.type ?? "text"}
            disabled={isNative}
          >
            {Object.entries(TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {!isNative && (
        <>
          <div>
            <Label htmlFor="options">
              Options (si liste déroulante, séparées par des virgules)
            </Label>
            <Input
              id="options"
              name="options"
              defaultValue={def?.options.join(", ")}
              placeholder="ex: Oui, Non, En cours"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="required"
              defaultChecked={def?.required}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Champ obligatoire
          </label>
        </>
      )}

      {state?.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : isEdit ? "Mettre à jour" : "Ajouter le champ"}
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

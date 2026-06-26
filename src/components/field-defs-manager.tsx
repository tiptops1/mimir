"use client";

import { useState, useTransition } from "react";
import { Button, Badge } from "@/components/ui";
import { FieldDefForm } from "@/components/field-def-form";
import { deleteFieldDef } from "@/app/actions/field-config";
import type { ConfigEntity, FieldDef } from "@/lib/field-config";

export type FieldDefRow = FieldDef & { id: string };

function FieldRow({ entity, def }: { entity: ConfigEntity; def: FieldDefRow }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return <FieldDefForm entity={entity} def={def} onDone={() => setEditing(false)} />;
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{def.label}</p>
          <Badge
            className={
              def.source === "NATIVE"
                ? "bg-surface-2 text-muted"
                : "bg-indigo-50 text-brand"
            }
          >
            {def.source === "NATIVE" ? "Natif" : "Personnalisé"}
          </Badge>
          <Badge className="bg-surface-2 text-muted">{def.type}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          clé: {def.key}
          {def.section ? ` · section: ${def.section}` : ""}
          {def.options.length > 0 ? ` · options: ${def.options.join(", ")}` : ""}
        </p>
        {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Modifier
        </Button>
        {def.source === "CUSTOM" &&
          (confirmingDelete ? (
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteFieldDef(def.id);
                  if (res.error) {
                    setError(res.error);
                    setConfirmingDelete(false);
                  }
                })
              }
            >
              Confirmer ?
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
              Supprimer
            </Button>
          ))}
      </div>
    </div>
  );
}

export function FieldDefsManager({
  entity,
  defs,
}: {
  entity: ConfigEntity;
  defs: FieldDefRow[];
}) {
  const [adding, setAdding] = useState(false);
  const sections = new Map<string, FieldDefRow[]>();
  for (const d of defs) {
    const list = sections.get(d.section || "Sans section") ?? [];
    list.push(d);
    sections.set(d.section || "Sans section", list);
  }

  return (
    <div className="space-y-5">
      {[...sections.entries()].map(([section, items]) => (
        <div key={section}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {section}
          </h3>
          <div className="space-y-2">
            {items.map((def) => (
              <FieldRow key={def.id} entity={entity} def={def} />
            ))}
          </div>
        </div>
      ))}

      {adding ? (
        <FieldDefForm entity={entity} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          + Ajouter un champ personnalisé
        </Button>
      )}
    </div>
  );
}

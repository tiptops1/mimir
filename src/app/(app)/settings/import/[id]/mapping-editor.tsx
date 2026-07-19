"use client";

import { useActionState, useMemo, useState } from "react";
import { saveMapping, type FormResult } from "@/app/actions/import";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
} from "@/components/ui";

interface TargetOption {
  value: string; // "ENTITY::key::SOURCE"
  label: string;
  entity: "COMPANY" | "CONTACT" | "DEAL";
}

interface Column {
  header: string;
  target: { entity: "COMPANY" | "CONTACT" | "DEAL"; key: string; source: "NATIVE" | "CUSTOM" } | null;
  confidence?: number;
}

const ENTITY_LABEL: Record<TargetOption["entity"], string> = {
  COMPANY: "Société",
  CONTACT: "Contact",
  DEAL: "Opportunité",
};

const toValue = (t: NonNullable<Column["target"]>) => `${t.entity}::${t.key}::${t.source}`;
const fromValue = (v: string): Column["target"] => {
  if (!v) return null;
  const [entity, key, source] = v.split("::");
  return { entity, key, source } as NonNullable<Column["target"]>;
};

export function MappingEditor({
  runId,
  columns,
  duplicatePolicy,
  samples,
  targets,
}: {
  runId: string;
  columns: Column[];
  duplicatePolicy: "skip" | "fillEmpty";
  samples: string[][];
  targets: TargetOption[];
}) {
  const [selected, setSelected] = useState<string[]>(
    columns.map((c) => (c.target ? toValue(c.target) : "")),
  );
  const action = useMemo(() => saveMapping.bind(null, runId), [runId]);
  const [state, formAction, pending] = useActionState<FormResult, FormData>(action, {});

  const grouped = useMemo(() => {
    const groups = new Map<TargetOption["entity"], TargetOption[]>();
    for (const t of targets) {
      const list = groups.get(t.entity) ?? [];
      list.push(t);
      groups.set(t.entity, list);
    }
    return groups;
  }, [targets]);

  const columnsJson = JSON.stringify(
    columns.map((c, i) => ({ header: c.header, target: fromValue(selected[i]) })),
  );

  return (
    <form action={formAction}>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Mapping des colonnes</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-semibold">Colonne source</th>
                <th className="px-4 py-2.5 font-semibold">Exemples</th>
                <th className="px-4 py-2.5 font-semibold">Champ Mimir</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col, i) => (
                <tr key={`${col.header}-${i}`} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-2.5 font-medium">{col.header}</td>
                  <td className="max-w-56 truncate px-4 py-2.5 text-xs text-muted">
                    {samples[i]?.length ? samples[i].join(" · ") : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Select
                        value={selected[i]}
                        onChange={(e) =>
                          setSelected((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                        }
                        className="w-64"
                      >
                        <option value="">Ignorer cette colonne</option>
                        {[...grouped.entries()].map(([entity, opts]) => (
                          <optgroup key={entity} label={ENTITY_LABEL[entity]}>
                            {opts.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </Select>
                      {col.target && selected[i] === toValue(col.target) && col.confidence === 1 && (
                        <span className="text-xs text-success">auto</span>
                      )}
                      {col.target && selected[i] === toValue(col.target) && col.confidence === 0.5 && (
                        <span className="text-xs text-warning">à vérifier</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CardBody className="border-t border-border">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="duplicatePolicy">Doublons (même SIRET)</Label>
              <Select id="duplicatePolicy" name="duplicatePolicy" defaultValue={duplicatePolicy} className="mt-1 w-64">
                <option value="skip">Ignorer (préserver l&apos;existant)</option>
                <option value="fillEmpty">Compléter les champs vides</option>
              </Select>
            </div>
            <div className="min-w-56 flex-1">
              <Label htmlFor="saveAsName">Enregistrer ce mapping (optionnel)</Label>
              <Input id="saveAsName" name="saveAsName" placeholder="ex. Export HubSpot" className="mt-1" />
            </div>
            <input type="hidden" name="columns" value={columnsJson} />
            <Button type="submit" disabled={pending}>
              {pending ? "Enregistrement…" : "Valider le mapping"}
            </Button>
          </div>
          {state.error && (
            <p className="mt-3 rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger">
              {state.error}
            </p>
          )}
        </CardBody>
      </Card>
    </form>
  );
}

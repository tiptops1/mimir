"use client";

import { useState, useTransition } from "react";
import { Input, Label, Select } from "@/components/ui";
import { setCompanyCustomField } from "@/app/actions/custom-fields";
import type { FieldDef } from "@/lib/field-config";

// Renders a company's tenant-defined custom fields from config (FieldDefinition),
// reading/writing the flexible `customFields` document. Each field saves on
// blur/change — no schema migration was needed to add any of them.

function FieldRow({
  companyId,
  def,
  initial,
}: {
  companyId: string;
  def: FieldDef;
  initial: string;
}) {
  const [val, setVal] = useState(initial);
  const [pending, start] = useTransition();
  const save = (raw: string) =>
    start(async () => {
      await setCompanyCustomField(companyId, def.key, raw);
    });

  return (
    <div>
      <Label htmlFor={`cf-${def.key}`}>
        {def.label}
        {pending && <span className="ml-2 text-[10px] text-muted">enregistrement…</span>}
      </Label>
      {def.type === "select" ? (
        <Select
          id={`cf-${def.key}`}
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            save(e.target.value);
          }}
        >
          <option value="">—</option>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : def.type === "bool" ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            id={`cf-${def.key}`}
            type="checkbox"
            checked={val === "true"}
            onChange={(e) => {
              const v = e.target.checked ? "true" : "false";
              setVal(v);
              save(v);
            }}
            className="h-4 w-4 rounded border-border"
          />
          Oui
        </label>
      ) : (
        <Input
          id={`cf-${def.key}`}
          type={def.type === "date" ? "date" : def.type === "number" ? "text" : "text"}
          inputMode={def.type === "number" ? "decimal" : undefined}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={(e) => {
            if (e.target.value !== initial) save(e.target.value);
          }}
        />
      )}
    </div>
  );
}

export function CustomFieldsSection({
  companyId,
  defs,
  values,
}: {
  companyId: string;
  defs: FieldDef[];
  values: Record<string, unknown>;
}) {
  if (defs.length === 0) {
    return (
      <p className="text-sm text-muted">
        Aucun champ personnalisé. Ajoutez-en via la configuration du tenant.
      </p>
    );
  }
  const toStr = (v: unknown, type: string): string => {
    if (v == null) return "";
    if (type === "bool") return v ? "true" : "false";
    return String(v);
  };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {defs.map((def) => (
        <FieldRow
          key={def.key}
          companyId={companyId}
          def={def}
          initial={toStr(values[def.key], def.type)}
        />
      ))}
    </div>
  );
}

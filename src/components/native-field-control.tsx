import type { FieldDef } from "@/lib/field-config";

// Renders the bare <input>/<select> for a NATIVE field def (metadata about an
// existing scalar Company/Contact column — see FieldDefinition.source in the
// schema). `name={def.key}` matches the Prisma field name, so this slots into
// the SAME company-form / company-inline-editor <form> + companySchema/
// updateCompany submit path that already existed — only the per-field JSX is
// generated from config now, not the save mechanism.
//
// stage / priorite / potentiel / canalPrefere / specialties stay hardcoded in
// the surrounding form: they're enums whose option VALUE differs from its
// French LABEL (e.g. "A" → "A — Haute"), which FieldDefinition.options (a
// plain string[] with no separate label) can't express yet.

export function nativeFieldDefaultValue(
  record: Record<string, unknown>,
  def: FieldDef,
): string {
  const v = record[def.key];
  if (v == null) return "";
  if (def.type === "date") {
    const d = typeof v === "string" || v instanceof Date ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
  }
  return String(v);
}

export function NativeFieldControl({
  def,
  defaultValue,
  className,
}: {
  def: FieldDef;
  defaultValue: string;
  className: string;
}) {
  if (def.type === "select") {
    return (
      <select name={def.key} defaultValue={defaultValue} className={className}>
        <option value="">—</option>
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (def.type === "date") {
    return (
      <input
        type="date"
        name={def.key}
        defaultValue={defaultValue}
        className={className}
      />
    );
  }
  if (def.type === "number") {
    return (
      <input
        type="number"
        name={def.key}
        defaultValue={defaultValue}
        className={className}
      />
    );
  }
  return (
    <input
      type="text"
      name={def.key}
      required={def.required}
      defaultValue={defaultValue}
      className={className}
    />
  );
}

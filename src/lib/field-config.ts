import { cache } from "react";
import { getTenantDb } from "./tenant-context";

// Phase-1 config store reader. Field definitions live as DATA (FieldDefinition
// collection in the tenant DB), so a tenant can add fields without code changes
// or a schema migration — values are stored on each record's flexible
// `customFields` document. Memoized per request via React cache.

export type FieldType = "text" | "number" | "select" | "bool" | "date";
export type ConfigEntity = "COMPANY" | "CONTACT" | "DEAL";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
  order: number;
}

export const getFieldDefs = cache(
  async (entity: ConfigEntity): Promise<FieldDef[]> => {
    const prisma = await getTenantDb();
    const rows = await prisma.fieldDefinition.findMany({
      where: { entity, showInForm: true },
      orderBy: [{ order: "asc" }, { label: "asc" }],
    });
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      type: r.type as FieldType,
      options: r.options,
      required: r.required,
      order: r.order,
    }));
  },
);

/** Coerce a raw form string to the stored value for a field type. null clears it. */
export function coerceFieldValue(def: FieldDef, raw: string): unknown {
  if (def.type === "number") {
    const n = Number.parseFloat(raw.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (def.type === "bool") {
    return raw === "true" || raw === "on" || raw === "1";
  }
  const t = raw.trim();
  if (!t) return null;
  if (def.type === "select" && !def.options.includes(t)) return null;
  return t;
}

/** Read a record's customFields Json into a plain string-keyed map. */
export function readCustomFields(
  value: unknown,
): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

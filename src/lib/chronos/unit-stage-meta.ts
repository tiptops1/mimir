// Client-safe unit-stage helpers — no server-only imports, so client components
// (filters, enum cells, badges) can use these without pulling in the tenant DB
// router. The actual DB reader lives in unit-stage-config.ts.
//
// Twin of src/lib/stage-meta.ts rather than a reuse: StageDefinition is global
// and un-scoped, so sharing it would inject inventory statuses into the CRM's
// pipeline kanban and company stage dropdown. See the UnitStageDefinition
// comment in prisma/tenant/schema.prisma.

export interface UnitStageDef {
  value: string;
  label: string;
  order: number;
  accent: string;
  badge: string;
  dot: string;
  /** Terminal-and-successful: the unit left stock through a sale. */
  isSold: boolean;
  /** Terminal-and-unsuccessful: written off, or returned to the supplier. */
  isDead: boolean;
}

// Used only if a tenant DB has no UnitStageDefinition rows yet (shouldn't happen
// once seedTenantConfig has run) so the UI never renders a statusless unit.
export const FALLBACK_UNIT_STAGE: UnitStageDef = {
  value: "ACQUIRED",
  label: "Acquise",
  order: 0,
  accent: "border-t-slate-400",
  badge: "bg-surface-2 text-foreground",
  dot: "bg-slate-400",
  isSold: false,
  isDead: false,
};

export function unitStageMetaFrom(defs: UnitStageDef[], value: string): UnitStageDef {
  return defs.find((d) => d.value === value) ?? defs[0] ?? FALLBACK_UNIT_STAGE;
}

export function unitStageLabelsFrom(defs: UnitStageDef[]): Record<string, string> {
  return Object.fromEntries(defs.map((d) => [d.value, d.label]));
}

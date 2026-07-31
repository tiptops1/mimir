// Client-safe unit-stage helpers — no server-only imports, so client components
// (filters, enum cells, badges) can use these without pulling in the tenant DB
// router. The actual DB reader lives in unit-stage-config.ts.
//
// Kept as the workshop's own vocabulary layer over src/lib/stage-meta.ts. Since
// S31 the STORAGE is shared (one entity-scoped StageDefinition collection), but
// the words are not: `isSold`/`isDead` here are the same two terminal flags
// stage-meta calls `isWon`/`isLost`, renamed at the boundary by
// unit-stage-config.ts. A watch is sold, not won.

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

// Used only if a tenant DB has no INVENTORY_UNIT stage rows yet (shouldn't
// happen once seedTenantConfig has run) so the UI never renders a statusless
// unit — and never falls back to the CRM's "À qualifier".
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

// Client-safe stage helpers — no server-only imports, so client components
// (badges, pipeline-board, etc.) can use these without pulling in the tenant
// DB router. The actual DB reader lives in stage-config.ts.

export interface StageDef {
  value: string;
  label: string;
  order: number;
  accent: string;
  badge: string;
  dot: string;
  /** Terminal AND successful. Surfaced as "isSold" in the workshop vocabulary. */
  isWon: boolean;
  /** Terminal AND unsuccessful. Surfaced as "isDead" in the workshop vocabulary. */
  isLost: boolean;
}

/**
 * Record types carrying a configurable lifecycle (S31). Lives here rather than
 * in stage-config.ts so the stage EDITOR, a client component, can import it
 * without pulling in the tenant DB router — the server/client split that is the
 * most common build break in this repo.
 */
export type StageEntity = "COMPANY" | "INVENTORY_UNIT";

/**
 * Trade vocabulary per entity. The same two terminal flags mean "won/lost" on a
 * sales pipeline and "sold/written off" on a watch — the storage is shared, the
 * words the operator reads are not (BRAND.md §7: labels are trade vocabulary).
 */
export const STAGE_ENTITY_VOCAB: Record<
  StageEntity,
  { title: string; tab: string; won: string; lost: string; keyExample: string }
> = {
  COMPANY: {
    title: "Étapes du pipeline",
    tab: "Sociétés",
    won: "Gagné",
    lost: "Perdu",
    keyExample: "ex: EN_NEGOCIATION",
  },
  INVENTORY_UNIT: {
    title: "Étapes de l'atelier",
    tab: "Montres",
    won: "Vendue",
    lost: "Perte",
    keyExample: "ex: EN_POLISSAGE",
  },
};

// Used only if a tenant DB has no StageDefinition rows yet (shouldn't happen once
// `npm run config:seed` has run) so the UI never renders an empty pipeline.
export const FALLBACK_STAGE: StageDef = {
  value: "A_QUALIFIER",
  label: "À qualifier",
  order: 0,
  accent: "border-t-slate-400",
  badge: "bg-surface-2 text-foreground",
  dot: "bg-slate-400",
  isWon: false,
  isLost: false,
};

export function stageMetaFrom(defs: StageDef[], value: string): StageDef {
  return defs.find((d) => d.value === value) ?? defs[0] ?? FALLBACK_STAGE;
}

export function stageLabelsFrom(defs: StageDef[]): Record<string, string> {
  return Object.fromEntries(defs.map((d) => [d.value, d.label]));
}

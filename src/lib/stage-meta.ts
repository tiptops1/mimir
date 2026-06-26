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
  isWon: boolean;
  isLost: boolean;
}

// Used only if a tenant DB has no StageDefinition rows yet (shouldn't happen once
// `npm run config:seed` has run) so the UI never renders an empty pipeline.
export const FALLBACK_STAGE: StageDef = {
  value: "A_QUALIFIER",
  label: "À qualifier",
  order: 0,
  accent: "border-t-slate-400",
  badge: "bg-slate-100 text-slate-700",
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

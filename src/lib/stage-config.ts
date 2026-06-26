import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { getTenantDb } from "./tenant-context";
import { type StageDef, FALLBACK_STAGE } from "./stage-meta";

// Phase-1 config store reader for pipeline stages — mirrors field-config.ts.
// Stages used to be a Prisma enum + a hardcoded array in lib/constants.ts; now
// they're DATA (StageDefinition collection), so a tenant can add/relabel/reorder
// stages without code changes (Phase 2 builds the edit UI on top of this).
//
// Server-only (imports the tenant DB router) — client components should import
// the StageDef type and stageMetaFrom/stageLabelsFrom from ./stage-meta instead.

export type { StageDef };
export { stageMetaFrom, stageLabelsFrom } from "./stage-meta";

/** Plain reader given a tenant Prisma client — for cron/scripts (no React render tree). */
export async function loadStageDefs(prisma: PrismaClient): Promise<StageDef[]> {
  const rows = await prisma.stageDefinition.findMany({ orderBy: { order: "asc" } });
  if (rows.length === 0) return [FALLBACK_STAGE];
  return rows.map((r) => ({
    value: r.key,
    label: r.label,
    order: r.order,
    accent: r.accentClass,
    badge: r.badgeClass,
    dot: r.dotClass,
    isWon: r.isWon,
    isLost: r.isLost,
  }));
}

/** Request-memoized reader for pages/components — resolves the tenant DB itself. */
export const getStageDefs = cache(async (): Promise<StageDef[]> => {
  const prisma = await getTenantDb();
  return loadStageDefs(prisma);
});

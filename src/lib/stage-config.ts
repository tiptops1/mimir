import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { getTenantDb } from "./tenant-context";
import { type StageDef, type StageEntity, FALLBACK_STAGE } from "./stage-meta";

// Config store reader for lifecycle stages — mirrors field-config.ts. Stages
// used to be a Prisma enum + a hardcoded array in lib/constants.ts; now they're
// DATA (StageDefinition collection), so a tenant can add/relabel/reorder stages
// without code changes.
//
// ENTITY-SCOPED since S31. Every read passes an entity, because the collection
// now holds both the sales pipeline (COMPANY) and the workshop lifecycle
// (INVENTORY_UNIT). A read with no scope would hand a company kanban its watch
// statuses — the exact bug the UnitStageDefinition twin existed to avoid before
// the scoping landed.
//
// Server-only (imports the tenant DB router) — client components should import
// the StageDef type and stageMetaFrom/stageLabelsFrom from ./stage-meta instead.

export type { StageDef, StageEntity };
export { stageMetaFrom, stageLabelsFrom } from "./stage-meta";

export const DEFAULT_STAGE_ENTITY: StageEntity = "COMPANY";

/**
 * Rows for one entity, with NO fallback — an empty result means exactly that.
 * Callers that need a placeholder supply their own, because the CRM's and the
 * workshop's fallbacks are different vocabulary ("À qualifier" vs "Acquise")
 * and substituting one for the other would render a watch as a sales lead.
 */
export async function loadStageDefsRaw(
  prisma: PrismaClient,
  entity: StageEntity,
): Promise<StageDef[]> {
  const rows = await prisma.stageDefinition.findMany({
    where: { entity },
    orderBy: { order: "asc" },
  });
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

/** Plain reader given a tenant Prisma client — for cron/scripts (no React render tree). */
export async function loadStageDefs(
  prisma: PrismaClient,
  entity: StageEntity = DEFAULT_STAGE_ENTITY,
): Promise<StageDef[]> {
  const defs = await loadStageDefsRaw(prisma, entity);
  return defs.length > 0 ? defs : [FALLBACK_STAGE];
}

/**
 * Request-memoized reader for pages/components — resolves the tenant DB itself.
 * `cache` keys on the argument, so the two entities memoize independently.
 */
export const getStageDefs = cache(
  async (entity: StageEntity = DEFAULT_STAGE_ENTITY): Promise<StageDef[]> => {
    const prisma = await getTenantDb();
    return loadStageDefs(prisma, entity);
  },
);

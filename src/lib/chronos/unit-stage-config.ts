import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { getTenantDb } from "@/lib/tenant-context";
import { type UnitStageDef, FALLBACK_UNIT_STAGE } from "./unit-stage-meta";

// Config-store reader for inventory-unit statuses (S27) — structural twin of
// src/lib/stage-config.ts. Statuses are DATA (UnitStageDefinition), so a tenant
// relabels or reorders its workshop pipeline without a deploy.
//
// Server-only (imports the tenant DB router) — client components should import
// the UnitStageDef type and unitStageMetaFrom/unitStageLabelsFrom from
// ./unit-stage-meta instead. Getting that split wrong is the most common build
// break in this repo.

export type { UnitStageDef };
export { unitStageMetaFrom, unitStageLabelsFrom } from "./unit-stage-meta";

/** Plain reader given a tenant Prisma client — for cron/scripts (no React render tree). */
export async function loadUnitStageDefs(prisma: PrismaClient): Promise<UnitStageDef[]> {
  const rows = await prisma.unitStageDefinition.findMany({ orderBy: { order: "asc" } });
  if (rows.length === 0) return [FALLBACK_UNIT_STAGE];
  return rows.map((r) => ({
    value: r.key,
    label: r.label,
    order: r.order,
    accent: r.accentClass,
    badge: r.badgeClass,
    dot: r.dotClass,
    isSold: r.isSold,
    isDead: r.isDead,
  }));
}

/** Request-memoized reader for pages/components — resolves the tenant DB itself. */
export const getUnitStageDefs = cache(async (): Promise<UnitStageDef[]> => {
  const prisma = await getTenantDb();
  return loadUnitStageDefs(prisma);
});

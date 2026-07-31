import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { getTenantDb } from "@/lib/tenant-context";
import { loadStageDefsRaw } from "@/lib/stage-config";
import { type UnitStageDef, FALLBACK_UNIT_STAGE } from "./unit-stage-meta";

// Config-store reader for inventory-unit statuses. Statuses are DATA, so a
// tenant relabels or reorders its workshop pipeline without a deploy.
//
// Since S31 this is a THIN ADAPTER over the shared, entity-scoped
// StageDefinition store rather than a reader of its own model: it scopes to
// INVENTORY_UNIT and renames the two terminal flags into workshop vocabulary
// (`isWon` → `isSold`, `isLost` → `isDead`). The flags mean "terminal and
// successful" / "terminal and unsuccessful" either way — only the trade word
// differs, and a watch is sold, not won.
//
// The file survives the collapse on purpose: every Chronos call site already
// imports `getUnitStageDefs`/`UnitStageDef`, and keeping the vertical's own
// vocabulary at its own boundary is worth one small adapter.
//
// Server-only (imports the tenant DB router) — client components should import
// the UnitStageDef type and unitStageMetaFrom/unitStageLabelsFrom from
// ./unit-stage-meta instead. Getting that split wrong is the most common build
// break in this repo.

export type { UnitStageDef };
export { unitStageMetaFrom, unitStageLabelsFrom } from "./unit-stage-meta";

/** Plain reader given a tenant Prisma client — for cron/scripts (no React render tree). */
export async function loadUnitStageDefs(prisma: PrismaClient): Promise<UnitStageDef[]> {
  // The RAW loader, so an empty result stays empty: loadStageDefs would
  // substitute the CRM's "À qualifier" placeholder, which must never appear on
  // a watch. The workshop supplies its own fallback below.
  const defs = await loadStageDefsRaw(prisma, "INVENTORY_UNIT");
  if (defs.length === 0) return [FALLBACK_UNIT_STAGE];
  return defs.map((d) => ({
    value: d.value,
    label: d.label,
    order: d.order,
    accent: d.accent,
    badge: d.badge,
    dot: d.dot,
    isSold: d.isWon,
    isDead: d.isLost,
  }));
}

/** Request-memoized reader for pages/components — resolves the tenant DB itself. */
export const getUnitStageDefs = cache(async (): Promise<UnitStageDef[]> => {
  const prisma = await getTenantDb();
  return loadUnitStageDefs(prisma);
});

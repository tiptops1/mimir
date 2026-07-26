import type { Prisma, PrismaClient } from "@prisma/client";
import {
  computeUnitMargin,
  summarizeMargins,
  type MarginSummary,
  type UnitMargin,
  type UnitMarginInput,
  type VatScheme,
} from "./margin";

/**
 * Chronos (S27) — the Prisma half of the margin computation. Loads units with
 * their cost ledger and maps them into margin.ts's plain-data inputs, which is
 * what keeps that module free of any Prisma import and unit-testable.
 *
 * Tenant PrismaClient as the first positional argument, so this stays callable
 * from crons, Inngest jobs and scripts/ with no session.
 */

const VAT_SCHEMES: VatScheme[] = ["MARGIN", "STANDARD", "EXEMPT"];

function asVatScheme(value: string | null | undefined, fallback: VatScheme): VatScheme {
  return VAT_SCHEMES.includes(value as VatScheme) ? (value as VatScheme) : fallback;
}

export interface ChronosVatConfig {
  vatScheme: VatScheme;
  vatRatePct: number;
}

/**
 * Read the tenant's VAT posture from the ChronosConfig singleton, falling back
 * to the schema defaults if the tenant was provisioned before the config seed.
 */
export async function loadVatConfig(prisma: PrismaClient): Promise<ChronosVatConfig> {
  const config = await prisma.chronosConfig.findUnique({
    where: { singleton: "default" },
    select: { vatScheme: true, vatRatePct: true },
  });
  return {
    vatScheme: asVatScheme(config?.vatScheme, "MARGIN"),
    vatRatePct: config?.vatRatePct ?? 23,
  };
}

/**
 * Margin for every unit matching `where`, newest acquisition first.
 *
 * Margin is derived, not stored, so it cannot be filtered or sorted in Prisma —
 * callers post-filter and sort the returned array. Fine at this tenant's
 * lifetime volume (low thousands); denormalising netMarginCents onto the unit
 * is the upgrade if that ever stops being true.
 */
export async function loadUnitMargins(
  prisma: PrismaClient,
  where: Prisma.InventoryUnitWhereInput = {},
  opts: { now?: Date; vat?: ChronosVatConfig } = {},
): Promise<UnitMargin[]> {
  const vat = opts.vat ?? (await loadVatConfig(prisma));
  const units = await prisma.inventoryUnit.findMany({
    where,
    orderBy: [{ acquiredAt: "desc" }],
    include: { costs: { select: { kind: true, baseAmountCents: true } } },
  });

  return units.map((u) => {
    const input: UnitMarginInput = {
      unitId: u.id,
      sku: u.sku,
      acquiredAt: u.acquiredAt,
      soldAt: u.soldAt,
      salePriceCents: u.salePriceCents,
      saleFxRate: u.saleFxRate,
      // A unit bought with a VAT invoice can't go through the margin scheme,
      // so the per-unit override wins over the tenant default.
      vatScheme: asVatScheme(u.vatScheme, vat.vatScheme),
      vatRatePct: vat.vatRatePct,
      costs: u.costs,
    };
    return computeUnitMargin(input, opts.now);
  });
}

/** Cockpit rollup across every unit matching `where`. */
export async function loadMarginSummary(
  prisma: PrismaClient,
  where: Prisma.InventoryUnitWhereInput = {},
  opts: { now?: Date } = {},
): Promise<MarginSummary> {
  return summarizeMargins(await loadUnitMargins(prisma, where, opts));
}

/**
 * Units still in stock.
 *
 * `isSet: false`, never `null`: MongoDB stores no soldAt field until one is
 * written, and Prisma's `soldAt: null` does NOT match a missing field on Mongo.
 * The null form silently matches nothing — the trap documented at
 * src/lib/ai-extract.ts:188, which already cost this codebase a production bug.
 */
export const UNSOLD_WHERE: Prisma.InventoryUnitWhereInput = {
  OR: [{ soldAt: null }, { soldAt: { isSet: false } }],
};

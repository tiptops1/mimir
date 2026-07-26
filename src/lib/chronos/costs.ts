import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

/**
 * Chronos (S27) — the SINGLE write path for unit costs.
 *
 * Nothing anywhere may call `prisma.unitCost.create` directly. Every cost line
 * goes through addUnitCost, which:
 *   1. computes baseAmountCents once (one source of truth for every sum), and
 *   2. requires a non-empty dedupeKey and upserts on (unitId, dedupeKey).
 *
 * That unique is what stops an S29 marketplace re-sync from double-booking the
 * fee lines it already booked — the single most load-bearing constraint in the
 * Chronos design. A create() call bypassing it would reintroduce the bug the
 * index exists to prevent.
 *
 * Tenant PrismaClient as the first positional argument (the convention in
 * src/lib/heimdallr/queries.ts) so these stay callable from crons, Inngest jobs
 * and scripts/ with no session.
 */

export interface AddUnitCostInput {
  unitId: string;
  /** See the UnitCost.kind vocab in prisma/tenant/schema.prisma. */
  kind: string;
  /** Always positive — `kind` carries the sign semantics. */
  amountCents: number;
  label?: string;
  currency?: string;
  /** Multiplier to base currency. Defaults to 1:1. */
  fxRate?: number;
  incurredAt?: Date;
  source?: string;
  /**
   * Stable identity of this line within its unit. Omit ONLY for a
   * human-entered line, which gets a random one — a synced line must always
   * supply a deterministic key derived from the upstream record, or the
   * re-sync guard does nothing.
   */
  dedupeKey?: string;
  partLotId?: string;
}

/** Convert to base currency. Rounded once, here, and never recomputed downstream. */
export function toBaseAmountCents(amountCents: number, fxRate = 1): number {
  const rate = fxRate > 0 ? fxRate : 1;
  return Math.round(amountCents * rate);
}

export async function addUnitCost(prisma: PrismaClient, input: AddUnitCostInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) {
    throw new Error(
      `addUnitCost: amountCents must be a non-negative integer (got ${input.amountCents}) — ` +
        `kind carries the sign, not the amount`,
    );
  }

  const dedupeKey = input.dedupeKey?.trim() || `manual:${randomUUID()}`;
  const fxRate = input.fxRate && input.fxRate > 0 ? input.fxRate : 1;
  const baseAmountCents = toBaseAmountCents(input.amountCents, fxRate);

  const data = {
    kind: input.kind,
    label: input.label ?? "",
    amountCents: input.amountCents,
    currency: input.currency ?? "EUR",
    fxRate,
    baseAmountCents,
    incurredAt: input.incurredAt ?? new Date(),
    source: input.source ?? "MANUAL",
    partLotId: input.partLotId ?? null,
  };

  return prisma.unitCost.upsert({
    where: { unitId_dedupeKey: { unitId: input.unitId, dedupeKey } },
    update: data,
    create: { unitId: input.unitId, dedupeKey, ...data },
  });
}

export interface ConsumePartInput {
  lotId: string;
  unitId: string;
  quantity?: number;
  consumedAt?: Date;
}

/**
 * Draw parts from a lot onto a unit: decrement the lot, record the consumption
 * with its cost SNAPSHOTTED, and book the matching PART cost line.
 *
 * The snapshot is the point — re-pricing a lot must never retroactively move
 * the margin on a unit already sold. The dedupeKey is derived from the
 * consumption row, so re-running converges instead of double-booking.
 */
export async function consumePart(prisma: PrismaClient, input: ConsumePartInput) {
  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`consumePart: quantity must be a positive integer (got ${quantity})`);
  }

  const lot = await prisma.partLot.findUnique({ where: { id: input.lotId } });
  if (!lot) throw new Error(`consumePart: unknown PartLot ${input.lotId}`);
  if (lot.remaining < quantity) {
    throw new Error(
      `consumePart: lot "${lot.label}" has ${lot.remaining} remaining, ${quantity} requested`,
    );
  }

  const consumedAt = input.consumedAt ?? new Date();
  const consumption = await prisma.partConsumption.create({
    data: {
      lotId: lot.id,
      unitId: input.unitId,
      quantity,
      unitCostCents: lot.unitCostCents,
      consumedAt,
    },
  });

  await prisma.partLot.update({
    where: { id: lot.id },
    data: { remaining: lot.remaining - quantity },
  });

  await addUnitCost(prisma, {
    unitId: input.unitId,
    kind: "PART",
    label: quantity > 1 ? `${lot.label} ×${quantity}` : lot.label,
    amountCents: lot.unitCostCents * quantity,
    incurredAt: consumedAt,
    source: "PART_LOT",
    dedupeKey: `partlot:${consumption.id}`,
    partLotId: lot.id,
  });

  return consumption;
}

/** Derive a lot's per-unit cost. Exported so a caller can preview it before writing. */
export function lotUnitCostCents(totalCostCents: number, quantity: number): number {
  if (quantity <= 0) throw new Error("lotUnitCostCents: quantity must be positive");
  return Math.round(totalCostCents / quantity);
}

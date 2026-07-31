import type { PrismaClient } from "@prisma/client";
import { addUnitCost } from "./costs";
import { effectiveRateCents, labourCostCents, workLogDedupeKey } from "./labour";

/**
 * Chronos (S24) — the write path for workshop labour.
 *
 * Structural twin of `consumePart` in costs.ts, and for the same reason: create
 * the record with its cost SNAPSHOTTED, then book the matching UnitCost line
 * through `addUnitCost` with a dedupeKey derived from that record.
 *
 * Two properties this buys, both load-bearing:
 *
 *  1. **Raises don't rewrite history.** The rate is copied onto the WorkLog at
 *     log time, so changing someone's hourly rate cannot retroactively move the
 *     margin on a watch sold last year — exactly what PartConsumption's
 *     `unitCostCents` snapshot protects against for parts.
 *  2. **The log and the cost line cannot drift.** The line is keyed
 *     `work:<workLogId>`, so re-running converges and deleting the log removes
 *     precisely its own line and nothing else.
 *
 * Nothing here calls `prisma.unitCost.create` — that remains forbidden
 * repo-wide (costs.ts header).
 */

export interface LogWorkInput {
  personId: string;
  unitId: string;
  minutes: number;
  performedAt?: Date;
  note?: string;
}

export async function logWork(prisma: PrismaClient, input: LogWorkInput) {
  if (!Number.isInteger(input.minutes) || input.minutes <= 0) {
    throw new Error(`logWork: minutes must be a positive integer (got ${input.minutes})`);
  }

  const person = await prisma.person.findUnique({ where: { id: input.personId } });
  if (!person) throw new Error(`logWork: unknown Person ${input.personId}`);

  const unit = await prisma.inventoryUnit.findUnique({
    where: { id: input.unitId },
    select: { id: true, sku: true },
  });
  if (!unit) throw new Error(`logWork: unknown InventoryUnit ${input.unitId}`);

  const config = await prisma.chronosConfig.findUnique({
    where: { singleton: "default" },
    select: { labourRateCentsPerHour: true },
  });

  const rateCentsPerHour = effectiveRateCents(
    person.hourlyRateCents,
    config?.labourRateCentsPerHour ?? 0,
  );
  const costCents = labourCostCents(input.minutes, rateCentsPerHour);
  const performedAt = input.performedAt ?? new Date();

  const log = await prisma.workLog.create({
    data: {
      personId: person.id,
      unitId: unit.id,
      minutes: input.minutes,
      rateCentsPerHour,
      costCents,
      performedAt,
      note: input.note ?? "",
    },
  });

  // A zero-cost log is legitimate — an unpaid owner's hour is still worth
  // recording as time — but booking a 0 € cost line would clutter the waterfall
  // with rows that change nothing.
  if (costCents > 0) {
    await addUnitCost(prisma, {
      unitId: unit.id,
      kind: "LABOUR",
      label: person.name,
      amountCents: costCents,
      incurredAt: performedAt,
      source: "WORK_LOG",
      dedupeKey: workLogDedupeKey(log.id),
    });
  }

  return log;
}

/** Remove a work log and the cost line it owns. Idempotent. */
export async function deleteWorkLog(prisma: PrismaClient, workLogId: string): Promise<void> {
  const log = await prisma.workLog.findUnique({ where: { id: workLogId } });
  if (!log) return;

  await prisma.unitCost.deleteMany({
    where: { unitId: log.unitId, dedupeKey: workLogDedupeKey(log.id) },
  });
  await prisma.workLog.delete({ where: { id: log.id } });
}

import "dotenv/config";
import { PrismaClient as TenantClient } from "@prisma/client";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { decrypt } from "../../src/lib/crypto";
import { deleteWorkLog, logWork } from "../../src/lib/chronos/work";
import { workLogDedupeKey } from "../../src/lib/chronos/labour";
import { loadUnitsWithMargins } from "../../src/lib/chronos/inventory";
import { UNSOLD_WHERE } from "../../src/lib/chronos/inventory";
import { formatCents } from "../../src/lib/display";
import { refuseInProd } from "../lib/guard";

refuseInProd();

/**
 * S24 verification — does logging time actually change what a watch cost?
 *
 *   npx tsx scripts/chronos/labour-check.ts [--slug chronos_demo] [--seed-demo]
 *
 * Proves the loop end to end:
 *  1. a work log books a LABOUR UnitCost through addUnitCost (never a direct
 *     create), keyed `work:<id>`;
 *  2. the unit's computed margin moves by exactly the labour cost;
 *  3. the rate is SNAPSHOTTED — changing the person's rate afterwards does not
 *     move an already-logged cost;
 *  4. deleting the log removes precisely its own line, and the margin returns.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string, detail = "") {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function netFor(prisma: TenantClient, unitId: string): Promise<number> {
  const margins = await loadUnitsWithMargins(prisma, { id: unitId });
  return margins[0]?.margin.totalCostCents ?? 0;
}

async function main() {
  const slug = arg("slug") ?? "chronos_demo";
  const control = new ControlClient();
  const tenant = await control.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`Unknown tenant: ${slug}`);
  const prisma = new TenantClient({ datasourceUrl: decrypt(tenant.connectionString) });

  console.log(`Labour check against "${slug}"\n`);

  const unit = await prisma.inventoryUnit.findFirst({
    where: UNSOLD_WHERE,
    select: { id: true, sku: true },
  });
  if (!unit) throw new Error("No unsold unit to test against.");

  const person = await prisma.person.upsert({
    where: { id: "000000000000000000000024" },
    update: { hourlyRateCents: 4_000, active: true },
    create: {
      id: "000000000000000000000024",
      name: "Horloger de contrôle",
      kind: "CONTRACTOR",
      hourlyRateCents: 4_000,
      active: true,
    },
  });

  const before = await netFor(prisma, unit.id);
  console.log(`Unit ${unit.sku} — coût avant : ${formatCents(before)}\n`);

  // 1 + 2. Log 90 minutes at 40 €/h = 60 €.
  const log = await logWork(prisma, { personId: person.id, unitId: unit.id, minutes: 90 });
  check(log.costCents === 6_000, "90 min at 40 €/h costs 60 €", formatCents(log.costCents));

  const line = await prisma.unitCost.findFirst({
    where: { unitId: unit.id, dedupeKey: workLogDedupeKey(log.id) },
  });
  check(
    line?.kind === "LABOUR" && line.baseAmountCents === 6_000 && line.source === "WORK_LOG",
    "a LABOUR cost line was booked through addUnitCost",
    `kind=${line?.kind} source=${line?.source} key=${line?.dedupeKey}`,
  );

  const after = await netFor(prisma, unit.id);
  check(
    after - before === 6_000,
    "the unit's total cost rose by exactly the labour cost",
    `${formatCents(before)} → ${formatCents(after)}`,
  );

  // 3. A raise must not rewrite history.
  await prisma.person.update({ where: { id: person.id }, data: { hourlyRateCents: 9_000 } });
  const reread = await prisma.workLog.findUnique({ where: { id: log.id } });
  const lineAfterRaise = await prisma.unitCost.findFirst({
    where: { unitId: unit.id, dedupeKey: workLogDedupeKey(log.id) },
  });
  check(
    reread?.rateCentsPerHour === 4_000 && lineAfterRaise?.baseAmountCents === 6_000,
    "raising the rate does NOT move an already-logged cost",
    `snapshot=${formatCents(reread?.rateCentsPerHour ?? 0)}/h, line=${formatCents(lineAfterRaise?.baseAmountCents ?? 0)}`,
  );

  // 4. Delete removes exactly its own line.
  await deleteWorkLog(prisma, log.id);
  const gone = await prisma.unitCost.findFirst({
    where: { unitId: unit.id, dedupeKey: workLogDedupeKey(log.id) },
  });
  const restored = await netFor(prisma, unit.id);
  check(
    gone === null && restored === before,
    "deleting the log removes its line and restores the cost",
    `${formatCents(restored)}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);

  if (process.argv.includes("--seed-demo")) {
    await prisma.person.update({ where: { id: person.id }, data: { hourlyRateCents: 4_000 } });
    const units = await prisma.inventoryUnit.findMany({
      where: UNSOLD_WHERE,
      select: { id: true },
      take: 3,
    });
    for (const [i, u] of units.entries()) {
      const existing = await prisma.workLog.findFirst({ where: { unitId: u.id } });
      if (existing) continue;
      await logWork(prisma, {
        personId: person.id,
        unitId: u.id,
        minutes: [90, 45, 150][i] ?? 60,
        note: ["Révision complète", "Polissage boîtier", "Remplacement joint + réglage"][i] ?? "",
      });
    }
    console.log("demo work logs seeded");
  } else {
    await prisma.person.update({ where: { id: person.id }, data: { active: false } });
  }

  await prisma.$disconnect();
  await control.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

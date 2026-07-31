import "dotenv/config";
import { PrismaClient as TenantClient } from "@prisma/client";
import { PrismaClient as ControlClient } from "../src/generated/control";
import { decrypt } from "../src/lib/crypto";
import { assertProdAllowed } from "./lib/guard";

assertProdAllowed();

/**
 * S31 — entity-scope StageDefinition. The ONE non-additive change in the whole
 * Chronos plan, and the only migration in this repo that `prisma db push`
 * cannot perform for you.
 *
 *   npx tsx scripts/migrate-stage-entity.ts --dry            # every tenant, no writes
 *   npx tsx scripts/migrate-stage-entity.ts                  # apply
 *   npx tsx scripts/migrate-stage-entity.ts --slug chronos_demo
 *
 * Four steps, in this order, and the order matters:
 *
 *  1. **Backfill `entity`.** MongoDB stores no field until one is written, so
 *     rows created before S31 have NO `entity` key at all — and a Prisma
 *     `@default` applies only to new writes, never retroactively. Without this,
 *     those rows match no scoped query and every pipeline silently empties.
 *  2. **Copy UnitStageDefinition → StageDefinition** as `INVENTORY_UNIT`,
 *     mapping `isSold → isWon` and `isDead → isLost`.
 *  3. **Drop `StageDefinition_key_key`.** `db push` creates the new compound
 *     unique but does NOT drop the old single-field one. Left in place it
 *     rejects the same key existing for two entities — which is the entire
 *     point of the change — and it fails at *write* time, long after the
 *     migration looked successful.
 *  4. **Drop the UnitStageDefinition collection**, once its rows are across.
 *
 * Steps 1 and 2 are idempotent (re-running converges). Step 3 tolerates the
 * index already being gone. Run `--dry` first — the standing rule for any
 * script that touches data.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface LegacyUnitStage {
  key: string;
  label: string;
  order?: number;
  accentClass?: string;
  badgeClass?: string;
  dotClass?: string;
  isSold?: boolean;
  isDead?: boolean;
}

async function migrateTenant(slug: string, url: string, dry: boolean): Promise<void> {
  const prisma = new TenantClient({ datasourceUrl: url });
  console.log(`\n── ${slug} ${dry ? "(dry run)" : ""}`);

  try {
    // ——— 1. backfill entity on pre-S31 rows ———
    const missing = (await prisma.$runCommandRaw({
      count: "StageDefinition",
      query: { entity: { $exists: false } },
    })) as { n?: number };
    const missingCount = missing.n ?? 0;

    if (missingCount > 0 && !dry) {
      await prisma.$runCommandRaw({
        update: "StageDefinition",
        updates: [
          {
            q: { entity: { $exists: false } },
            u: { $set: { entity: "COMPANY" } },
            multi: true,
          },
        ],
      });
    }
    console.log(`  1. backfill entity → COMPANY: ${missingCount} row(s)`);

    // ——— 2. copy the twin's rows across ———
    let legacy: LegacyUnitStage[] = [];
    try {
      const res = (await prisma.$runCommandRaw({
        find: "UnitStageDefinition",
        filter: {},
      })) as { cursor?: { firstBatch?: LegacyUnitStage[] } };
      legacy = res.cursor?.firstBatch ?? [];
    } catch {
      // Collection never existed on this tenant (a CRM-only tenant). Not an error.
      legacy = [];
    }

    let copied = 0;
    for (const row of legacy) {
      const data = {
        label: row.label,
        order: row.order ?? 0,
        accentClass: row.accentClass ?? "",
        badgeClass: row.badgeClass ?? "",
        dotClass: row.dotClass ?? "",
        isWon: row.isSold ?? false,
        isLost: row.isDead ?? false,
      };
      if (!dry) {
        await prisma.stageDefinition.upsert({
          where: { entity_key: { entity: "INVENTORY_UNIT", key: row.key } },
          update: data,
          create: { entity: "INVENTORY_UNIT", key: row.key, ...data },
        });
      }
      copied += 1;
    }
    console.log(`  2. UnitStageDefinition → StageDefinition(INVENTORY_UNIT): ${copied} row(s)`);

    // ——— 3. drop the stale single-field unique ———
    // The load-bearing step. db push will not do this, and its absence only
    // surfaces later as a write failure on a key that legitimately exists under
    // two entities. A dry run must therefore actually LOOK — reporting "not
    // present" without checking is worse than not reporting at all.
    const indexes = (await prisma.$runCommandRaw({
      listIndexes: "StageDefinition",
    }).catch(() => ({}))) as { cursor?: { firstBatch?: Array<{ name?: string }> } };
    const names = (indexes.cursor?.firstBatch ?? []).map((i) => i.name);
    const stalePresent = names.includes("StageDefinition_key_key");

    let dropped: string;
    if (dry) {
      dropped = stalePresent ? "PRESENT — will be dropped" : "already absent";
    } else if (!stalePresent) {
      dropped = "already absent";
    } else {
      try {
        await prisma.$runCommandRaw({
          dropIndexes: "StageDefinition",
          index: "StageDefinition_key_key",
        });
        dropped = "dropped";
      } catch (e) {
        dropped = `FAILED — ${(e as Error).message.slice(0, 80)}`;
      }
    }
    console.log(`  3. index StageDefinition_key_key: ${dropped}`);
    console.log(`     (indexes present: ${names.join(", ") || "none"})`);

    // ——— 4. drop the emptied twin ———
    let collectionDropped = dry ? "would drop after copying" : "skipped";
    if (!dry) {
      try {
        await prisma.$runCommandRaw({ drop: "UnitStageDefinition" });
        collectionDropped = "dropped";
      } catch {
        collectionDropped = "not present";
      }
    }
    console.log(`  4. collection UnitStageDefinition: ${collectionDropped}`);

    // ——— report ———
    const [company, unit] = await Promise.all([
      prisma.stageDefinition.count({ where: { entity: "COMPANY" } }),
      prisma.stageDefinition.count({ where: { entity: "INVENTORY_UNIT" } }),
    ]);
    console.log(
      `  → StageDefinition${dry ? " (BEFORE any writes)" : ""}: ` +
        `${company} COMPANY, ${unit} INVENTORY_UNIT`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const dry = process.argv.includes("--dry");
  const only = arg("slug");

  const control = new ControlClient();
  const tenants = await control.tenant.findMany({
    where: only ? { slug: only } : { status: "ACTIVE" },
    select: { slug: true, connectionString: true },
  });

  if (tenants.length === 0) throw new Error(only ? `Unknown tenant: ${only}` : "No ACTIVE tenants");

  console.log(
    `S31 stage-entity migration · ${tenants.length} tenant(s)${dry ? " · DRY RUN, no writes" : ""}`,
  );

  for (const t of tenants) {
    await migrateTenant(t.slug, decrypt(t.connectionString), dry);
  }

  if (dry) console.log("\nDry run — nothing written. Re-run without --dry to apply.");
  await control.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

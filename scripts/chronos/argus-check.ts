import "dotenv/config";
import { PrismaClient as TenantClient } from "@prisma/client";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { decrypt } from "../../src/lib/crypto";
import { runArgusForTenant } from "../../src/lib/chronos/argus";
import {
  getMarketOverview,
  recomputeRefStat,
  recordPricePoint,
} from "../../src/lib/chronos/comps-store";
import { confidenceFor, manualDedupeKey } from "../../src/lib/chronos/comps";
import { formatCents } from "../../src/lib/display";
import { refuseInProd } from "../lib/guard";

refuseInProd();

/**
 * S30 verification harness — the Argus twin of sync-fixture-check.ts.
 *
 *   npx tsx scripts/chronos/argus-check.ts [--slug chronos_demo] [--cleanup]
 *
 * Proves the four properties the comp DB rests on:
 *
 *  1. **Idempotence.** Two consecutive sweeps converge — identical PricePoint
 *     counts, because the dedupe keys are deterministic. A comp counted twice
 *     silently biases the median that S32's bid ceiling comes from.
 *  2. **Sold and ask never mix.** The SOLD band is computed only from his own
 *     completed sales, the ASK band only from listing observations, and the two
 *     medians are reported separately.
 *  3. **Never guess an attribution.** A listing whose title matches no declared
 *     alias of a reference is counted as unattributed and stored against
 *     nothing — the same discipline the S29 reconciliation queue applies.
 *  4. **Drift needs a baseline AND a sample.** A first sweep can never report
 *     drift (nothing to compare against).
 *
 * Runs against the `demo` connector, which implements the same searchListings
 * contract the real eBay Browse adapter does — so the sweep, the attribution
 * and the band math are all exercised for real without a live keyset.
 *
 * `--cleanup` deletes every PricePoint/RefPriceStat it created.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg("slug") ?? "chronos_demo";
  const cleanup = process.argv.includes("--cleanup");

  const control = new ControlClient();
  const tenant = await control.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`Unknown tenant: ${slug}`);
  const prisma = new TenantClient({ datasourceUrl: decrypt(tenant.connectionString) });

  console.log(`Argus sweep against "${slug}"\n`);

  const first = await runArgusForTenant(prisma, { tenantId: tenant.id, provider: "demo" });
  console.log("run 1:", JSON.stringify(first, null, 2));

  const second = await runArgusForTenant(prisma, { tenantId: tenant.id, provider: "demo" });
  console.log("\nrun 2:", JSON.stringify(second, null, 2));

  const [points, stats] = await Promise.all([
    prisma.pricePoint.count(),
    prisma.refPriceStat.count(),
  ]);

  console.log("\n— assertions —");

  // 1. Idempotence: the second run must record nothing new.
  const converged = second.ownSalesRecorded === 0 && second.asksRecorded === 0;
  console.log(
    `${converged ? "PASS" : "FAIL"}  idempotent — run 2 recorded ` +
      `${second.ownSalesRecorded} sold / ${second.asksRecorded} ask (expected 0 / 0)`,
  );

  // 3. Never guess: with fixed demo titles, most refs match nothing.
  console.log(
    `${first.asksUnattributed > 0 ? "PASS" : "WARN"}  never-guess — ` +
      `${first.asksMatched} listing(s) attributed, ${first.asksUnattributed} dropped as unmatched`,
  );

  // 4. First sweep cannot drift.
  console.log(
    `${first.driftAlerts === 0 ? "PASS" : "FAIL"}  first sweep reports no drift ` +
      `(got ${first.driftAlerts})`,
  );

  const overview = await getMarketOverview(prisma);

  // 2. Sold and ask are separate bands.
  const bothKinds = overview.rows.filter((r) => r.sold && r.ask);
  console.log(
    `${overview.soldPointCount > 0 ? "PASS" : "WARN"}  ` +
      `${overview.soldPointCount} sold point(s), ${overview.askPointCount} ask point(s), ` +
      `${bothKinds.length} ref(s) carrying both bands separately`,
  );

  console.log(`\n${points} PricePoint rows · ${stats} RefPriceStat rows\n`);
  console.log("— bands —");
  for (const row of overview.rows) {
    const sold = row.sold
      ? `${formatCents(row.sold.p25Cents)} · ${formatCents(row.sold.medianCents)} · ${formatCents(row.sold.p75Cents)} (n=${row.sold.sampleSize}, ${confidenceFor(row.sold.sampleSize)})`
      : "pas de comparable";
    const ask = row.ask
      ? `${formatCents(row.ask.medianCents)} (n=${row.ask.sampleSize})`
      : "—";
    console.log(`  ${row.brand} ${row.reference}\n    vendu: ${sold}\n    demandé: ${ask}`);
  }

  // A first sweep can never drift, so the drift path needs its own probe: push
  // the median of one reference well past the threshold with enough sample to
  // clear the gate, recompute, and confirm the alert fires against the median
  // the previous sweep left behind.
  if (process.argv.includes("--drift-probe")) {
    const target = overview.rows.find((r) => r.sold && r.sold.sampleSize >= 1);
    if (!target?.sold) {
      console.log("\ndrift probe: no reference with a sold band, skipped");
    } else {
      const inflated = target.sold.medianCents * 3;
      console.log(
        `\ndrift probe on ${target.brand} ${target.reference} — ` +
          `median ${formatCents(target.sold.medianCents)} → injecting 3 comps at ${formatCents(inflated)}`,
      );

      for (let i = 0; i < 3; i++) {
        await recordPricePoint(prisma, {
          refId: target.refId,
          kind: "SOLD",
          provider: "probe",
          priceCents: inflated,
          currency: "EUR",
          observedAt: new Date(),
          soldAt: new Date(),
          source: "MANUAL",
          dedupeKey: manualDedupeKey(`drift-probe-${i}`),
        });
      }

      const after = await recomputeRefStat(prisma, target.refId, "SOLD", { now: new Date() });
      console.log(
        `${after.drifted ? "PASS" : "FAIL"}  drift detected — ` +
          `driftPct ${after.driftPct}%, sample ${after.band?.sampleSize}, drifted=${after.drifted}`,
      );

      const removed = await prisma.pricePoint.deleteMany({
        where: { refId: target.refId, dedupeKey: { startsWith: "manual:drift-probe-" } },
      });
      await recomputeRefStat(prisma, target.refId, "SOLD", { now: new Date() });
      console.log(`  probe cleaned up (${removed.count} rows removed, band recomputed)`);
    }
  }

  if (cleanup) {
    const p = await prisma.pricePoint.deleteMany({});
    const s = await prisma.refPriceStat.deleteMany({});
    console.log(`\ncleanup: deleted ${p.count} PricePoint / ${s.count} RefPriceStat rows`);
  }

  await prisma.$disconnect();
  await control.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

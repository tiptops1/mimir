import "dotenv/config";
import { PrismaClient as TenantClient } from "@prisma/client";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { decrypt } from "../../src/lib/crypto";
import { seedTenantConfig } from "../../src/lib/default-config";
import { addUnitCost } from "../../src/lib/chronos/costs";
import { loadUnitMargins } from "../../src/lib/chronos/inventory";
import { summarizeMargins } from "../../src/lib/chronos/margin";
import { formatCents } from "../../src/lib/display";
import { refuseInProd } from "../lib/guard";

refuseInProd();

/**
 * Chronos (S27) demo inventory — 30 units across the whole lifecycle.
 *
 *   npm run chronos:seed-demo [-- <slug>]        (default: chronos_demo)
 *
 * Control-plane bootstrap (not the lighter freyja seed's shape) because the
 * target tenant is NOT the default DATABASE_URL — chronos_demo has its own DB.
 *
 * Deterministic and idempotent: no randomness anywhere, ProductRef upserts on
 * its composite unique, InventoryUnit on sku, and EVERY cost line goes through
 * addUnitCost with a stable derived dedupeKey. Running twice must converge on
 * identical counts — that is the proof that @@unique([unitId, dedupeKey]) is
 * really enforced on the tenant DB, not merely declared in the schema.
 */

const SLUG = process.argv[2] ?? "chronos_demo";
const UNIT_COUNT = 30;

// A fixed "today" so a re-run days later still produces the same dates and the
// same margin figures. Matches the session date.
const NOW = new Date("2026-07-26T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

interface RefSeed {
  brand: string;
  reference: string;
  model: string;
  variant?: string;
  attributes: Record<string, unknown>;
}

const REFS: RefSeed[] = [
  { brand: "Seiko", reference: "SKX007", model: "Diver's 200m", attributes: { caliber: "7S26", caseSizeMm: 42, material: "acier" } },
  { brand: "Seiko", reference: "SARB033", model: "Mechanical", attributes: { caliber: "6R15", caseSizeMm: 38, material: "acier" } },
  { brand: "Omega", reference: "2531.80", model: "Seamaster 300M", attributes: { caliber: "1120", caseSizeMm: 41, material: "acier" } },
  { brand: "Tissot", reference: "T137.410", model: "PRX 40", attributes: { caliber: "quartz", caseSizeMm: 40, material: "acier" } },
  { brand: "Certina", reference: "C032.407", model: "DS Action Diver", attributes: { caliber: "Powermatic 80", caseSizeMm: 43, material: "acier" } },
  { brand: "Longines", reference: "L3.716", model: "Conquest", attributes: { caliber: "L888", caseSizeMm: 41, material: "acier" } },
  { brand: "Hamilton", reference: "H69439931", model: "Khaki Field Mechanical", attributes: { caliber: "H-50", caseSizeMm: 38, material: "acier" } },
  { brand: "Oris", reference: "01 733", model: "Aquis Date", attributes: { caliber: "SW200-1", caseSizeMm: 43, material: "acier" } },
];

/**
 * A 10-slot cycle rather than one-slot-per-status: a flat `i % STATUSES.length`
 * gives an unrealistic five-of-each and leaves too few sales for the realised
 * margin figures to mean anything. Weighted toward SOLD (4/10) so the cockpit
 * has real revenue, while still touching all six statuses.
 */
const STATUS_CYCLE = [
  "ACQUIRED",
  "IN_WORKSHOP",
  "READY",
  "LISTED",
  "SOLD",
  "SOLD",
  "SOLD",
  "WRITTEN_OFF",
  "SOLD",
  "LISTED",
];

/**
 * Indices deliberately given a bad outcome. Both MUST fall on a SOLD slot of
 * STATUS_CYCLE (positions 4,5,6,8 mod 10) or the case silently never happens —
 * which is exactly the bug the assertion at the end of main() now catches.
 */
const LOSER_INDEX = 5; // bought high, sold under cost
const REFUND_INDEX = 15; // returned by the buyer; the refund wipes the margin

const MARKETPLACES = ["ebay", "chrono24", "vinted", "leboncoin"];
const CONDITIONS = ["Bon état", "Très bon état", "Excellent état", "À réviser"];
const SUPPLIERS = ["eBay UK", "Salon Paris", "Particulier", "Lot brocante"];

/**
 * Unit i's shape, derived purely from i. Buckets rather than randomness, the
 * seed-demo-data.ts convention — a re-run cannot drift.
 */
function unitSpec(i: number) {
  const ref = REFS[i % REFS.length];
  const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
  const sold = status === "SOLD";
  const acquiredDaysAgo = 15 + ((i * 23) % 300);
  const heldDays = 20 + ((i * 17) % 120);

  // Acquisition 300–1 700 €, stepped so no two consecutive units match.
  const acquisitionCents = 30_000 + ((i * 7919) % 140_000);
  // Sale price is normally a healthy markup; the loser is deliberately sold
  // under cost so a negative margin is always on screen.
  const isLoser = sold && i === LOSER_INDEX;
  const salePriceCents = isLoser
    ? Math.round(acquisitionCents * 0.72)
    : Math.round(acquisitionCents * (1.35 + ((i % 5) * 0.12)));

  return {
    ref,
    status,
    sold,
    isLoser,
    sku: `WCH-${String(i + 1).padStart(4, "0")}`,
    serial: `SN${String(100_000 + i * 137)}`,
    condition: CONDITIONS[i % CONDITIONS.length],
    supplier: SUPPLIERS[i % SUPPLIERS.length],
    acquiredAt: daysAgo(acquiredDaysAgo),
    soldAt: sold ? daysAgo(Math.max(1, acquiredDaysAgo - heldDays)) : null,
    soldOn: sold ? MARKETPLACES[i % MARKETPLACES.length] : null,
    listedAt: ["LISTED", "SOLD"].includes(status) ? daysAgo(acquiredDaysAgo - 10) : null,
    acquisitionCents,
    salePriceCents: sold ? salePriceCents : null,
    // Restoration effort scales with condition bucket.
    labourHours: 1 + (i % 4),
    partsCents: 1_200 + ((i * 311) % 6_000),
    consumableCents: 200 + ((i * 97) % 900),
    shippingInCents: 800 + ((i * 53) % 1_500),
    // One unit in five came from the UK and carries duty.
    dutyCents: i % 5 === 0 ? 1_500 + ((i * 31) % 2_000) : 0,
    refundCents: sold && i === REFUND_INDEX ? Math.round(salePriceCents * 0.35) : 0,
  };
}

const LABOUR_RATE_CENTS_PER_HOUR = 3_500;

async function main() {
  const control = new ControlClient();
  const tenant = await control.tenant.findUnique({
    where: { slug: SLUG },
    select: { connectionString: true, modules: true },
  });
  if (!tenant) throw new Error(`Unknown tenant: ${SLUG}`);
  if (!tenant.modules.includes("chronos")) {
    throw new Error(
      `Tenant "${SLUG}" is not entitled to the chronos module (has: ${tenant.modules.join(", ")})`,
    );
  }

  const prisma = new TenantClient({ datasourceUrl: decrypt(tenant.connectionString) });

  try {
    console.log(`Seeding Chronos demo inventory for "${SLUG}"…`);
    await seedTenantConfig(prisma, { modules: tenant.modules });

    const config = await prisma.chronosConfig.findUnique({ where: { singleton: "default" } });
    const feeModel = (config?.feeModel ?? {}) as Record<
      string,
      { finalValuePct?: number; fixedCents?: number; paymentPct?: number; regulatoryPct?: number }
    >;

    let costLines = 0;

    for (let i = 0; i < UNIT_COUNT; i++) {
      const spec = unitSpec(i);

      const ref = await prisma.productRef.upsert({
        where: {
          brand_reference_variant: {
            brand: spec.ref.brand,
            reference: spec.ref.reference,
            variant: spec.ref.variant ?? "",
          },
        },
        update: { model: spec.ref.model, attributes: spec.ref.attributes as never },
        create: {
          brand: spec.ref.brand,
          reference: spec.ref.reference,
          model: spec.ref.model,
          variant: spec.ref.variant ?? "",
          attributes: spec.ref.attributes as never,
          aliases: [
            `${spec.ref.brand} ${spec.ref.reference}`.toLowerCase(),
            `${spec.ref.brand} ${spec.ref.model}`.toLowerCase(),
          ],
        },
      });

      const unitData = {
        refId: ref.id,
        serial: spec.serial,
        status: spec.status,
        condition: spec.condition,
        acquiredAt: spec.acquiredAt,
        acquiredVia: spec.supplier === "eBay UK" ? "ebay" : "particulier",
        supplier: spec.supplier,
        listedAt: spec.listedAt,
        soldAt: spec.soldAt,
        soldOn: spec.soldOn,
        salePriceCents: spec.salePriceCents,
        saleCurrency: spec.sold ? "EUR" : null,
      };

      const unit = await prisma.inventoryUnit.upsert({
        where: { sku: spec.sku },
        update: unitData,
        create: { sku: spec.sku, ...unitData },
      });

      // --- cost ledger. Every line has a stable dedupeKey derived from the
      // unit + line identity, so a re-run upserts rather than duplicating.
      const lines: Parameters<typeof addUnitCost>[1][] = [
        {
          unitId: unit.id,
          kind: "ACQUISITION",
          label: `Achat — ${spec.supplier}`,
          amountCents: spec.acquisitionCents,
          incurredAt: spec.acquiredAt,
          source: "IMPORT",
          dedupeKey: "seed:acquisition",
        },
        {
          unitId: unit.id,
          kind: "SHIPPING_IN",
          label: "Port entrant",
          amountCents: spec.shippingInCents,
          incurredAt: spec.acquiredAt,
          source: "IMPORT",
          dedupeKey: "seed:shipping_in",
        },
      ];

      if (spec.dutyCents > 0) {
        lines.push({
          unitId: unit.id,
          kind: "DUTY",
          label: "Droits de douane (UK)",
          amountCents: spec.dutyCents,
          incurredAt: spec.acquiredAt,
          source: "IMPORT",
          dedupeKey: "seed:duty",
        });
      }

      // Restoration only once the unit has actually been through the workshop.
      if (spec.status !== "ACQUIRED") {
        lines.push(
          {
            unitId: unit.id,
            kind: "PART",
            label: "Pièces de rechange",
            amountCents: spec.partsCents,
            incurredAt: daysAgo(5),
            source: "MANUAL",
            dedupeKey: "seed:parts",
          },
          {
            unitId: unit.id,
            kind: "CONSUMABLE",
            label: "Joints, huile, produits",
            amountCents: spec.consumableCents,
            incurredAt: daysAgo(5),
            source: "MANUAL",
            dedupeKey: "seed:consumables",
          },
          {
            unitId: unit.id,
            kind: "LABOUR",
            label: `Main-d'œuvre — ${spec.labourHours} h`,
            amountCents: spec.labourHours * LABOUR_RATE_CENTS_PER_HOUR,
            incurredAt: daysAgo(5),
            source: "MANUAL",
            dedupeKey: "seed:labour",
          },
        );
      }

      // Sold units carry the real fee shape a marketplace statement produces:
      // a percentage final-value fee, a fixed component, and outbound postage.
      if (spec.sold && spec.salePriceCents && spec.soldOn) {
        const fees = feeModel[spec.soldOn] ?? {};
        const pct = (fees.finalValuePct ?? 0) + (fees.regulatoryPct ?? 0);
        const marketplaceFee = Math.round((spec.salePriceCents * pct) / 100) + (fees.fixedCents ?? 0);
        const paymentFee = Math.round((spec.salePriceCents * (fees.paymentPct ?? 0)) / 100);

        if (marketplaceFee > 0) {
          lines.push({
            unitId: unit.id,
            kind: "MARKETPLACE_FEE",
            label: `Commission ${spec.soldOn}`,
            amountCents: marketplaceFee,
            incurredAt: spec.soldAt!,
            source: "IMPORT",
            dedupeKey: "seed:marketplace_fee",
          });
        }
        if (paymentFee > 0) {
          lines.push({
            unitId: unit.id,
            kind: "PAYMENT_FEE",
            label: "Frais de paiement",
            amountCents: paymentFee,
            incurredAt: spec.soldAt!,
            source: "IMPORT",
            dedupeKey: "seed:payment_fee",
          });
        }
        lines.push({
          unitId: unit.id,
          kind: "SHIPPING_OUT",
          label: "Port sortant assuré",
          amountCents: 1_400,
          incurredAt: spec.soldAt!,
          source: "IMPORT",
          dedupeKey: "seed:shipping_out",
        });

        if (spec.refundCents > 0) {
          lines.push({
            unitId: unit.id,
            kind: "REFUND",
            label: "Retour client — remboursement partiel",
            amountCents: spec.refundCents,
            incurredAt: daysAgo(3),
            source: "MANUAL",
            dedupeKey: "seed:refund",
          });
        }
      }

      for (const line of lines) {
        await addUnitCost(prisma, line);
        costLines++;
      }

      // Converge from ANY prior state, not just from an identical run: if the
      // fixture changes so a unit is no longer sold, its old fee lines must go
      // or the margin keeps counting them. Scoped to this seed's own `seed:`
      // keys, so a human's manual cost line is never touched.
      await prisma.unitCost.deleteMany({
        where: {
          unitId: unit.id,
          dedupeKey: { startsWith: "seed:", notIn: lines.map((l) => l.dedupeKey!) },
        },
      });
    }

    // --- report, computed through the real library rather than re-derived.
    const margins = await loadUnitMargins(prisma, {}, { now: NOW });
    const summary = summarizeMargins(margins);
    const refCount = await prisma.productRef.count();
    const unitCount = await prisma.inventoryUnit.count();
    const storedCostCount = await prisma.unitCost.count();

    console.log(`\n  ${refCount} références · ${unitCount} unités · ${storedCostCount} lignes de coût`);
    console.log(`  (${costLines} lignes écrites cette exécution — égal au total si idempotent)`);
    console.log(`\n  En stock  : ${summary.inStockCount} unités, ${formatCents(summary.cashTiedUpCents)} immobilisés`);
    for (const bucket of summary.ageing) {
      console.log(`    ${bucket.bucket.padEnd(6)} j : ${bucket.unitCount} unités · ${formatCents(bucket.cashTiedUpCents)}`);
    }
    console.log(`\n  Vendues   : ${summary.soldCount} unités`);
    console.log(`    CA          ${formatCents(summary.revenueCents)}`);
    console.log(`    Coûts       ${formatCents(summary.totalCostCents)}`);
    console.log(`    TVA (marge) ${formatCents(summary.vatCents)}`);
    console.log(`    Marge nette ${formatCents(summary.netMarginCents)} (${summary.marginPct?.toFixed(1)} %)`);
    console.log(`    Marge/jour  ${formatCents(summary.avgMarginPerDayCents)} en moyenne`);

    const negatives = margins.filter((m) => m.sold && m.netMarginCents < 0);
    console.log(`\n  ${negatives.length} vente(s) à perte : ${negatives.map((m) => m.sku).join(", ") || "—"}`);

    // Self-checks: the demo set exists to exercise the hard cases, and the
    // first draft of this script silently produced none of them because
    // LOSER_INDEX/REFUND_INDEX landed on non-SOLD slots of the status cycle.
    // Fail loudly rather than seed a reassuring, useless fixture.
    if (summary.soldCount === 0) throw new Error("Seed produced no sold units — no realised margin to check");
    if (negatives.length === 0) throw new Error("Seed produced no loss-making sale — check LOSER_INDEX lands on a SOLD slot");
    const refunded = margins.filter((m) => m.groups.refunds > 0);
    if (refunded.length === 0) throw new Error("Seed produced no refund line — check REFUND_INDEX lands on a SOLD slot");
    const feeBearing = margins.filter((m) => m.sold && m.groups.fees > 0);
    if (feeBearing.length === 0) throw new Error("Seed produced no marketplace fee lines");
    console.log(`  ${refunded.length} retour(s) · ${feeBearing.length} vente(s) avec commissions réelles`);
  } finally {
    await prisma.$disconnect();
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

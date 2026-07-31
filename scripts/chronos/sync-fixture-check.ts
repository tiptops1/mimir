import "dotenv/config";
import { PrismaClient as TenantClient } from "@prisma/client";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { decrypt } from "../../src/lib/crypto";
import { runChronosSyncForTenant } from "../../src/lib/chronos/sync";
import type { ConnectorOrder } from "../../src/lib/chronos/connectors/types";
import { formatCents } from "../../src/lib/display";
import { refuseInProd } from "../lib/guard";

refuseInProd();

/**
 * S29 verification harness: drive the marketplace sync with FIXTURE orders
 * instead of a live eBay account, and prove the two properties that matter.
 *
 *   npx tsx scripts/chronos/sync-fixture-check.ts [--slug chronos_demo] [--cleanup]
 *
 *  1. **Idempotence.** The same orders applied twice must converge — identical
 *     UnitCost and MarketplaceOrder counts on both runs. This is the S27a bar
 *     (the demo seed converging on 169 cost lines) applied to the sync, and it
 *     is what the deterministic dedupe keys exist to guarantee.
 *  2. **Never guess.** A line with an unknown SKU, and a line with no SKU at
 *     all, must write NOTHING to any unit and land in the reconciliation queue.
 *
 * Fixtures rather than the real adapter because eBay's production OAuth
 * redirect must be public https, so consent cannot complete from localhost.
 * Everything downstream of the token is exercised here for real: the mapping,
 * the upserts, the queue, the AgentEvent.
 *
 * `--cleanup` reverts every write it made, so the demo tenant is left as found.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const PROVIDER = "fixture_market";

function fixtureOrders(skuA: string, skuB: string): ConnectorOrder[] {
  const soldAt = new Date("2026-07-22T12:00:00.000Z");
  return [
    {
      externalId: "FIX-1001",
      soldAt,
      currency: "EUR",
      grossCents: 185000,
      lines: [
        {
          sku: skuA,
          title: "Montre A",
          quantity: 1,
          grossCents: 185000,
          currency: "EUR",
          fees: [
            { kind: "FINAL_VALUE_FEE", label: "Commission", amountCents: 23680, currency: "EUR" },
            { kind: "REGULATORY_OPERATING_FEE", label: "Frais réglementaires", amountCents: 648, currency: "EUR" },
            { kind: "SHIPPING_LABEL", label: "Étiquette", amountCents: 1450, currency: "EUR" },
          ],
        },
      ],
    },
    {
      externalId: "FIX-1002",
      soldAt,
      currency: "EUR",
      grossCents: 92000,
      lines: [
        {
          sku: skuB,
          title: "Montre B",
          quantity: 1,
          grossCents: 92000,
          currency: "EUR",
          fees: [
            { kind: "FINAL_VALUE_FEE", label: "Commission", amountCents: 11776, currency: "EUR" },
          ],
        },
      ],
    },
    {
      // Unknown SKU — must queue, must not create anything.
      externalId: "FIX-1003",
      soldAt,
      currency: "EUR",
      grossCents: 45000,
      lines: [
        {
          sku: "SKU-QUI-NEXISTE-PAS",
          title: "Montre inconnue",
          quantity: 1,
          grossCents: 45000,
          currency: "EUR",
          fees: [{ kind: "FINAL_VALUE_FEE", label: "Commission", amountCents: 5760, currency: "EUR" }],
        },
      ],
    },
    {
      // No SKU at all — the common real case (no listing custom label set).
      externalId: "FIX-1004",
      soldAt,
      currency: "EUR",
      grossCents: 33000,
      lines: [
        {
          sku: null,
          title: "Vente sans libellé personnalisé",
          quantity: 1,
          grossCents: 33000,
          currency: "EUR",
          fees: [{ kind: "FINAL_VALUE_FEE", label: "Commission", amountCents: 4224, currency: "EUR" }],
        },
      ],
    },
  ];
}

async function counts(prisma: TenantClient) {
  const [costs, orders, pending] = await Promise.all([
    prisma.unitCost.count({ where: { dedupeKey: { startsWith: `${PROVIDER}:` } } }),
    prisma.marketplaceOrder.count({ where: { provider: PROVIDER } }),
    prisma.marketplaceOrder.count({ where: { provider: PROVIDER, status: "PENDING" } }),
  ]);
  return { costs, orders, pending };
}

async function main() {
  const slug = arg("slug") ?? "chronos_demo";
  const cleanup = process.argv.includes("--cleanup");

  const control = new ControlClient();
  const tenant = await control.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`Unknown tenant: ${slug}`);
  const prisma = new TenantClient({ datasourceUrl: decrypt(tenant.connectionString) });

  try {
    // Two unsold units to sell. isSet:false is the Mongo trap — "not yet sold"
    // is an ABSENT field, which `null` does not match.
    const units = await prisma.inventoryUnit.findMany({
      where: { OR: [{ soldAt: null }, { soldAt: { isSet: false } }] },
      orderBy: { sku: "asc" },
      take: 2,
      select: { id: true, sku: true, soldAt: true, salePriceCents: true },
    });
    if (units.length < 2) throw new Error("Need at least 2 unsold units — run npm run chronos:seed-demo");

    const [a, b] = units;
    console.log(`Tenant ${slug} · fixtures against ${a.sku} and ${b.sku}\n`);

    const orders = fixtureOrders(a.sku, b.sku);

    const run1 = await runChronosSyncForTenant(prisma, {
      tenantId: tenant.id,
      provider: PROVIDER,
      fetchOrders: async () => orders,
    });
    const after1 = await counts(prisma);
    console.log("run 1:", run1);
    console.log("       counts:", after1);

    const run2 = await runChronosSyncForTenant(prisma, {
      tenantId: tenant.id,
      provider: PROVIDER,
      fetchOrders: async () => orders,
    });
    const after2 = await counts(prisma);
    console.log("run 2:", run2);
    console.log("       counts:", after2);

    // — Assertions —
    const problems: string[] = [];
    if (after1.costs !== after2.costs) {
      problems.push(`NOT IDEMPOTENT: cost lines ${after1.costs} -> ${after2.costs}`);
    }
    if (after1.orders !== after2.orders) {
      problems.push(`NOT IDEMPOTENT: order rows ${after1.orders} -> ${after2.orders}`);
    }
    if (after2.pending !== 2) {
      problems.push(`expected 2 PENDING orders (unknown SKU + no SKU), got ${after2.pending}`);
    }

    const ghost = await prisma.inventoryUnit.findUnique({ where: { sku: "SKU-QUI-NEXISTE-PAS" } });
    if (ghost) problems.push("an unmatched SKU created a unit — the sync must never invent one");

    const sold = await prisma.inventoryUnit.findUnique({
      where: { id: a.id },
      select: { salePriceCents: true, soldOn: true, costs: { where: { dedupeKey: { startsWith: `${PROVIDER}:` } } } },
    });
    console.log(
      `\n${a.sku}: vendue ${formatCents(sold?.salePriceCents ?? 0)} sur ${sold?.soldOn} · ` +
        `${sold?.costs.length} ligne(s) de frais synchronisées`,
    );
    if (sold?.costs.length !== 3) {
      problems.push(`expected 3 fee lines on ${a.sku}, got ${sold?.costs.length}`);
    }

    console.log(
      problems.length
        ? `\n✗ ${problems.length} problem(s):\n  ${problems.join("\n  ")}`
        : "\n✓ idempotent across two runs · unmatched lines queued with zero unit writes",
    );

    if (cleanup) {
      await prisma.unitCost.deleteMany({ where: { dedupeKey: { startsWith: `${PROVIDER}:` } } });
      await prisma.marketplaceOrder.deleteMany({ where: { provider: PROVIDER } });
      for (const u of units) {
        await prisma.inventoryUnit.update({
          where: { id: u.id },
          data: {
            soldAt: null,
            soldOn: null,
            saleExternalId: null,
            salePriceCents: null,
            saleCurrency: null,
            saleFxRate: null,
          },
        });
      }
      await prisma.agentEvent.deleteMany({
        where: { module: "chronos", category: "sync" },
      });
      console.log("✓ cleaned up — tenant left as found");
    }

    process.exit(problems.length ? 1 : 0);
  } finally {
    await prisma.$disconnect();
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

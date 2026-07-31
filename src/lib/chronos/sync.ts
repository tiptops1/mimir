import type { PrismaClient } from "@prisma/client";
import { addUnitCost } from "./costs";
import { getConnector, isApiConnector } from "./connectors";
import type { ConnectorOrder } from "./connectors/types";
import {
  mapOrderToUnitWrites,
  totalFeesBaseCents,
  type MappedOrder,
  type MatchedLine,
} from "./sync-map";
import { parseMarketplaces } from "./config";

/**
 * Chronos marketplace sync (S29).
 *
 * Runs SYNCHRONOUSLY inside /api/cron/chronos, on the Freyja/Forseti snapshot
 * posture: deterministic, no LLM, no Inngest. There is nothing multi-step to
 * resume here — the work is a fetch, a join and a set of idempotent upserts.
 *
 * Idempotency comes from two uniques and no state table:
 *   MarketplaceOrder @@unique([provider, externalId])  — the order row
 *   UnitCost         @@unique([unitId, dedupeKey])     — every fee line
 * so the rolling overlap window below can re-fetch the same orders on every run
 * and converge rather than accumulate. That is deliberately a window and not a
 * cursor: a cursor that advances past a late-arriving fee loses it forever.
 *
 * INGESTION, NOT A LEDGER ACTION. Mirroring a sale that already happened writes
 * domain state directly, exactly as runGmailSync does. Heimdallr governs agent
 * proposals; it has no business gating a fact.
 */

export const CHRONOS_MODULE = "chronos";

export interface ChronosSyncResult {
  provider: string;
  ordersSeen: number;
  ordersMatched: number;
  ordersPending: number;
  costLinesWritten: number;
  unitsUpdated: number;
  skipped?: string;
}

export interface ChronosSyncOptions {
  tenantId: string;
  /** Rolling overlap window. Wider than any plausible fee-settlement delay. */
  sinceDays?: number;
  /** Injectable for tests and the CSV importer; defaults to the real adapter. */
  fetchOrders?: (since: Date) => Promise<ConnectorOrder[]>;
  provider?: string;
}

interface FxConfig {
  baseCurrency: string;
  fxRates: Record<string, number>;
}

async function readFx(prisma: PrismaClient): Promise<FxConfig> {
  const config = await prisma.chronosConfig.findUnique({
    where: { singleton: "default" },
    select: { baseCurrency: true, fxRates: true },
  });
  const raw = config?.fxRates;
  const fxRates: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" && v > 0) fxRates[k.toUpperCase()] = v;
    }
  }
  return { baseCurrency: config?.baseCurrency ?? "EUR", fxRates };
}

/**
 * Apply one matched line to its unit: stamp the sale facts and upsert the fee
 * lines. Returns null when the SKU resolves to nothing — the caller queues it
 * rather than inventing a unit, because a marketplace SKU we've never seen is
 * as likely to be a typo as a missing record.
 */
async function applyMatchedLine(
  prisma: PrismaClient,
  line: MatchedLine,
): Promise<{ unitId: string; costLines: number } | null> {
  const unit = await prisma.inventoryUnit.findUnique({
    where: { sku: line.sku },
    select: { id: true },
  });
  if (!unit) return null;

  await prisma.inventoryUnit.update({
    where: { id: unit.id },
    data: {
      soldAt: line.sale.soldAt,
      soldOn: line.sale.soldOn,
      saleExternalId: line.sale.saleExternalId,
      salePriceCents: line.sale.salePriceCents,
      saleCurrency: line.sale.saleCurrency,
      saleFxRate: line.sale.saleFxRate,
    },
  });

  for (const cost of line.costs) {
    await addUnitCost(prisma, { unitId: unit.id, ...cost });
  }

  return { unitId: unit.id, costLines: line.costs.length };
}

/** Persist the order row — always, matched or not. It is the audit trail. */
async function recordOrder(
  prisma: PrismaClient,
  provider: string,
  order: ConnectorOrder,
  mapped: MappedOrder,
  applied: { unitId: string; sku: string } | null,
): Promise<void> {
  const unmatchedReason = mapped.unmatched[0]?.reason ?? null;
  const data = {
    soldAt: order.soldAt,
    currency: order.currency,
    grossCents: Math.round(order.grossCents),
    status: applied ? "MATCHED" : "PENDING",
    sku: applied?.sku ?? null,
    unitId: applied?.unitId ?? null,
    lines: order.lines as unknown as object,
    unmatchedReason: applied ? null : unmatchedReason,
    syncedAt: new Date(),
  };

  const existing = await prisma.marketplaceOrder.findUnique({
    where: { provider_externalId: { provider, externalId: order.externalId } },
    select: { status: true },
  });

  // A human decision outranks the sync. Once someone has matched or explicitly
  // ignored an order, a later run must not quietly reopen it.
  if (existing && (existing.status === "MATCHED" || existing.status === "IGNORED") && !applied) {
    await prisma.marketplaceOrder.update({
      where: { provider_externalId: { provider, externalId: order.externalId } },
      data: { syncedAt: new Date() },
    });
    return;
  }

  await prisma.marketplaceOrder.upsert({
    where: { provider_externalId: { provider, externalId: order.externalId } },
    update: data,
    create: { provider, externalId: order.externalId, ...data },
  });
}

export async function runChronosSyncForTenant(
  prisma: PrismaClient,
  opts: ChronosSyncOptions,
): Promise<ChronosSyncResult> {
  const sinceDays = opts.sinceDays ?? 14;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  // Which marketplace syncs by API is tenant CONFIG, not a hardcoded "ebay".
  const marketplaces = parseMarketplaces(
    (
      await prisma.chronosConfig.findUnique({
        where: { singleton: "default" },
        select: { marketplaces: true },
      })
    )?.marketplaces,
  );
  const provider =
    opts.provider ??
    marketplaces.find((m) => m.sync === "api" && isApiConnector(m.key))?.key ??
    "";

  const empty: ChronosSyncResult = {
    provider,
    ordersSeen: 0,
    ordersMatched: 0,
    ordersPending: 0,
    costLinesWritten: 0,
    unitsUpdated: 0,
  };

  if (!provider) {
    return { ...empty, skipped: "no API-capable marketplace configured" };
  }

  let orders: ConnectorOrder[];
  if (opts.fetchOrders) {
    orders = await opts.fetchOrders(since);
  } else {
    const connector = getConnector(provider);
    if (!connector.fetchOwnOrders) {
      return { ...empty, skipped: `${provider} cannot fetch orders` };
    }
    orders = await connector.fetchOwnOrders({ tenantId: opts.tenantId }, since);
    // fetchOwnOrders returns [] when the tenant hasn't connected eBay, which is
    // a normal state, not an error — same as a tenant without Google.
  }

  const fx = await readFx(prisma);
  const result: ChronosSyncResult = { ...empty, ordersSeen: orders.length };

  for (const order of orders) {
    const mapped = mapOrderToUnitWrites(order, {
      provider,
      baseCurrency: fx.baseCurrency,
      fxRates: fx.fxRates,
      source: provider === "ebay" ? "EBAY_ORDER" : "IMPORT",
    });

    let applied: { unitId: string; sku: string } | null = null;
    for (const line of mapped.matched) {
      const outcome = await applyMatchedLine(prisma, line);
      if (!outcome) continue;
      applied = { unitId: outcome.unitId, sku: line.sku };
      result.costLinesWritten += outcome.costLines;
      result.unitsUpdated++;
    }

    await recordOrder(prisma, provider, order, mapped, applied);
    if (applied) result.ordersMatched++;
    else result.ordersPending++;
  }

  await prisma.agentEvent.create({
    data: {
      module: CHRONOS_MODULE,
      category: "sync",
      action: "completed",
      data: { ...result, sinceDays },
    },
  });

  return result;
}

export interface SyncPreviewRow {
  externalId: string;
  sku: string | null;
  soldAt: Date;
  grossCents: number;
  feeCount: number;
  feeTotalBaseCents: number;
  /** matched = the SKU resolves to a unit; pending = it will queue instead. */
  outcome: "matched" | "pending";
  reason?: string;
}

export interface SyncPreview {
  rows: SyncPreviewRow[];
  matched: number;
  pending: number;
}

/**
 * What applying these orders WOULD do. Reads only.
 *
 * The CSV wizard's dry run. It deliberately replays the same
 * `mapOrderToUnitWrites` the write path uses, so "9 matched, 2 queued" in the
 * preview is the same computation that later runs — a preview produced by
 * different code is a preview of nothing.
 */
export async function previewChronosSync(
  prisma: PrismaClient,
  orders: ConnectorOrder[],
  opts: { provider: string },
): Promise<SyncPreview> {
  const fx = await readFx(prisma);
  const rows: SyncPreviewRow[] = [];

  const skus = new Set<string>();
  for (const order of orders) {
    for (const line of order.lines) if (line.sku) skus.add(line.sku.trim());
  }
  const known = new Set(
    (
      await prisma.inventoryUnit.findMany({
        where: { sku: { in: [...skus] } },
        select: { sku: true },
      })
    ).map((u) => u.sku),
  );

  for (const order of orders) {
    const mapped = mapOrderToUnitWrites(order, {
      provider: opts.provider,
      baseCurrency: fx.baseCurrency,
      fxRates: fx.fxRates,
    });

    for (const line of mapped.matched) {
      const resolves = known.has(line.sku);
      rows.push({
        externalId: order.externalId,
        sku: line.sku,
        soldAt: order.soldAt,
        grossCents: line.sale.salePriceCents,
        feeCount: line.costs.length,
        feeTotalBaseCents: totalFeesBaseCents(line),
        outcome: resolves ? "matched" : "pending",
        reason: resolves ? undefined : "SKU inconnu en stock",
      });
    }
    for (const line of mapped.unmatched) {
      rows.push({
        externalId: order.externalId,
        sku: line.sku,
        soldAt: order.soldAt,
        grossCents: line.grossCents,
        feeCount: 0,
        feeTotalBaseCents: 0,
        outcome: "pending",
        reason: line.reason === "no_sku" ? "Aucun SKU" : "Quantité > 1",
      });
    }
  }

  return {
    rows,
    matched: rows.filter((r) => r.outcome === "matched").length,
    pending: rows.filter((r) => r.outcome === "pending").length,
  };
}

/**
 * Apply an order a human has matched to a unit by hand. Replays the SAME pure
 * mapping over the stored lines, so a reconciled order lands identically to an
 * auto-matched one — no second, subtly-different code path.
 */
export async function reconcileOrderToUnit(
  prisma: PrismaClient,
  orderId: string,
  unitId: string,
): Promise<{ costLines: number }> {
  const order = await prisma.marketplaceOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new Error(`Unknown marketplace order ${orderId}`);

  const unit = await prisma.inventoryUnit.findUnique({
    where: { id: unitId },
    select: { id: true, sku: true },
  });
  if (!unit) throw new Error(`Unknown inventory unit ${unitId}`);

  const fx = await readFx(prisma);
  const lines = Array.isArray(order.lines) ? order.lines : [];

  // Force the operator's chosen SKU onto every line: they have decided this
  // order is that unit, and the stored SKU is precisely what was wrong.
  const rebuilt: ConnectorOrder = {
    externalId: order.externalId,
    soldAt: order.soldAt,
    currency: order.currency,
    grossCents: order.grossCents,
    lines: (lines as unknown as ConnectorOrder["lines"]).map((l) => ({
      ...l,
      sku: unit.sku,
      quantity: 1,
    })),
  };

  const mapped = mapOrderToUnitWrites(rebuilt, {
    provider: order.provider,
    baseCurrency: fx.baseCurrency,
    fxRates: fx.fxRates,
    source: order.provider === "ebay" ? "EBAY_ORDER" : "IMPORT",
  });

  let costLines = 0;
  for (const line of mapped.matched) {
    const outcome = await applyMatchedLine(prisma, line);
    if (outcome) costLines += outcome.costLines;
  }

  await prisma.marketplaceOrder.update({
    where: { id: order.id },
    data: { status: "MATCHED", sku: unit.sku, unitId: unit.id, unmatchedReason: null },
  });

  await prisma.agentEvent.create({
    data: {
      module: CHRONOS_MODULE,
      category: "sync",
      action: "reconciled",
      data: { provider: order.provider, externalId: order.externalId, sku: unit.sku, costLines },
    },
  });

  return { costLines };
}

export async function ignoreOrder(prisma: PrismaClient, orderId: string): Promise<void> {
  await prisma.marketplaceOrder.update({
    where: { id: orderId },
    data: { status: "IGNORED", unmatchedReason: null },
  });
}

import { accessTokenForTenant, ebayHosts } from "@/lib/ebay-oauth";
import type {
  ConnectorCtx,
  ConnectorFee,
  ConnectorOrder,
  ConnectorOrderLine,
  ConnectorOwnListing,
  MarketplaceConnector,
} from "./types";

/**
 * eBay Sell adapter (S29).
 *
 * Capabilities, and why:
 *  - `ownOrders: true`  — the reason this exists. eBay is the only marketplace
 *    he sells on that reports the REAL fee breakdown, so his true margin
 *    reconciles to the cent instead of resting on estimateFees().
 *  - `ownListings: true` — his live listings, to stamp listing ids on units.
 *  - `soldComps: false` — Marketplace Insights is Limited Release and denied to
 *    non-major-partners. connectors.test.ts asserts this stays false.
 *  - `searchListings: false` — Browse (asking prices, app token) is S30's comp
 *    DB work, and asking prices must never render as sold comps. Flipping this
 *    on means implementing the method in the same commit; the drift test
 *    enforces that.
 *
 * ORDER FEES COME FROM TWO APIS, joined on order id:
 *   Fulfillment /order       → line items, SKU, per-line gross
 *   Finances    /transaction → the authoritative fee lines
 * Fulfillment alone reports only a coarse total; Finances alone has no SKU. The
 * join is what makes a fee attributable to a unit.
 *
 * Field names below follow eBay's documented shapes but are read defensively —
 * every access tolerates absence. Verify against a real payload on the first
 * live run (docs/chronos/ops.md); anything that drifts is contained to this file,
 * because everything downstream consumes the normalised ConnectorOrder.
 */

const PAGE_LIMIT = 50;
/** Stop rather than page forever if a filter is wrong. */
const MAX_PAGES = 40;

interface EbayAmount {
  value?: string;
  currency?: string;
}

/** eBay returns money as a decimal STRING. Never parse it as a float into cents. */
export function toCentsFromEbayAmount(amount: EbayAmount | undefined): number {
  const raw = amount?.value?.trim();
  if (!raw) return 0;
  const negative = raw.startsWith("-");
  const digits = raw.replace(/[^0-9.]/g, "");
  const [whole = "0", frac = ""] = digits.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isFinite(cents)) return 0;
  return negative ? -cents : cents;
}

async function ebayGet<T>(
  ctx: ConnectorCtx,
  path: string,
  params: Record<string, string>,
): Promise<T | null> {
  const token = await accessTokenForTenant(ctx.tenantId);
  if (!token) return null;

  const url = new URL(path, ebayHosts().api);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      // Marketplace matters for Fulfillment/Inventory reads; IE sits on the UK
      // marketplace, which is where his EU/UK sales land.
      "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE_ID?.trim() || "EBAY_GB",
    },
  });

  if (res.status === 429) {
    throw new Error("eBay rate limit hit — back off and retry this sync later");
  }
  if (!res.ok) {
    throw new Error(`eBay ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ————— Finances: the fee ledger —————

interface FinanceTransaction {
  transactionType?: string;
  orderId?: string;
  transactionDate?: string;
  amount?: EbayAmount;
  feeType?: string;
  orderLineItems?: Array<{
    lineItemId?: string;
    marketplaceFees?: Array<{ feeType?: string; amount?: EbayAmount }>;
  }>;
}

/** orderId → fee lines, flattened across every transaction on that order. */
async function feesByOrder(
  ctx: ConnectorCtx,
  since: Date,
): Promise<Map<string, ConnectorFee[]>> {
  const byOrder = new Map<string, ConnectorFee[]>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await ebayGet<{ transactions?: FinanceTransaction[] }>(
      ctx,
      "/sell/finances/v1/transaction",
      {
        filter: `transactionDate:[${since.toISOString()}..]`,
        limit: String(PAGE_LIMIT),
        offset: String(page * PAGE_LIMIT),
      },
    );
    const batch = data?.transactions ?? [];
    if (batch.length === 0) break;

    for (const tx of batch) {
      const orderId = tx.orderId;
      if (!orderId) continue;
      const list = byOrder.get(orderId) ?? [];

      // Per-line fees: the precise form, when eBay breaks them out.
      for (const li of tx.orderLineItems ?? []) {
        for (const fee of li.marketplaceFees ?? []) {
          const cents = Math.abs(toCentsFromEbayAmount(fee.amount));
          if (cents === 0) continue;
          list.push({
            kind: fee.feeType ?? "OTHER",
            label: fee.feeType ?? "Frais eBay",
            amountCents: cents,
            currency: fee.amount?.currency ?? "EUR",
          });
        }
      }

      // Order-level charges and refunds arrive as their own transactions.
      const type = (tx.transactionType ?? "").toUpperCase();
      if (type === "NON_SALE_CHARGE" || type === "REFUND") {
        const cents = Math.abs(toCentsFromEbayAmount(tx.amount));
        if (cents > 0) {
          list.push({
            kind: type === "REFUND" ? "REFUND" : (tx.feeType ?? "OTHER"),
            label: type === "REFUND" ? "Remboursement" : (tx.feeType ?? "Frais eBay"),
            amountCents: cents,
            currency: tx.amount?.currency ?? "EUR",
          });
        }
      }

      byOrder.set(orderId, list);
    }

    if (batch.length < PAGE_LIMIT) break;
  }

  return byOrder;
}

// ————— Fulfillment: the line items —————

interface FulfillmentOrder {
  orderId?: string;
  creationDate?: string;
  pricingSummary?: { total?: EbayAmount };
  lineItems?: Array<{
    sku?: string;
    title?: string;
    quantity?: number;
    lineItemCost?: EbayAmount;
    deliveryCost?: { shippingCost?: EbayAmount };
  }>;
}

export const ebayConnector: MarketplaceConnector = {
  provider: "ebay",
  capabilities: {
    searchListings: false,
    soldComps: false,
    ownListings: true,
    ownOrders: true,
  },

  async fetchOwnOrders(ctx: ConnectorCtx, since: Date): Promise<ConnectorOrder[]> {
    const fees = await feesByOrder(ctx, since);
    const orders: ConnectorOrder[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await ebayGet<{ orders?: FulfillmentOrder[] }>(
        ctx,
        "/sell/fulfillment/v1/order",
        {
          filter: `creationdate:[${since.toISOString()}..]`,
          limit: String(PAGE_LIMIT),
          offset: String(page * PAGE_LIMIT),
        },
      );
      const batch = data?.orders ?? [];
      if (batch.length === 0) break;

      for (const raw of batch) {
        const orderId = raw.orderId;
        if (!orderId) continue;

        const currency = raw.pricingSummary?.total?.currency ?? "EUR";
        const orderFees = fees.get(orderId) ?? [];
        const lineItems = raw.lineItems ?? [];

        const lines: ConnectorOrderLine[] = lineItems.map((li, i) => {
          const lineFees: ConnectorFee[] = [];
          // Order-level fees attach to the first line. Splitting them across
          // lines would be an allocation guess, and a multi-line order is
          // already the rare case for one-of-a-kind stock.
          if (i === 0) lineFees.push(...orderFees);

          const shipping = toCentsFromEbayAmount(li.deliveryCost?.shippingCost);
          if (shipping > 0) {
            lineFees.push({
              kind: "SHIPPING_OUT",
              label: "Frais de port",
              amountCents: shipping,
              currency: li.deliveryCost?.shippingCost?.currency ?? currency,
            });
          }

          return {
            sku: li.sku?.trim() || null,
            title: li.title ?? "",
            quantity: li.quantity ?? 1,
            grossCents: toCentsFromEbayAmount(li.lineItemCost),
            currency: li.lineItemCost?.currency ?? currency,
            fees: lineFees,
          };
        });

        orders.push({
          externalId: orderId,
          soldAt: raw.creationDate ? new Date(raw.creationDate) : new Date(),
          currency,
          grossCents: toCentsFromEbayAmount(raw.pricingSummary?.total),
          lines,
        });
      }

      if (batch.length < PAGE_LIMIT) break;
    }

    return orders;
  },

  async fetchOwnListings(ctx: ConnectorCtx): Promise<ConnectorOwnListing[]> {
    interface Offer {
      offerId?: string;
      sku?: string;
      listing?: { listingId?: string };
      pricingSummary?: { price?: EbayAmount };
      listingDescription?: string;
      availableQuantity?: number;
    }

    const listings: ConnectorOwnListing[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await ebayGet<{ offers?: Offer[] }>(ctx, "/sell/inventory/v1/offer", {
        limit: String(PAGE_LIMIT),
        offset: String(page * PAGE_LIMIT),
      });
      const batch = data?.offers ?? [];
      if (batch.length === 0) break;

      for (const offer of batch) {
        const externalId = offer.listing?.listingId ?? offer.offerId;
        if (!externalId) continue;
        listings.push({
          externalId,
          sku: offer.sku?.trim() || null,
          title: offer.sku ?? "",
          askPriceCents: toCentsFromEbayAmount(offer.pricingSummary?.price),
          currency: offer.pricingSummary?.price?.currency ?? "EUR",
          // The Offer payload carries no listing date; the sync stamps its own.
          listedAt: new Date(),
        });
      }

      if (batch.length < PAGE_LIMIT) break;
    }
    return listings;
  },
};

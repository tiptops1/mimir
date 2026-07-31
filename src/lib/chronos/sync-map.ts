import type { ConnectorFee, ConnectorOrder, ConnectorOrderLine } from "./connectors/types";
import { fxRateFor as baseFxRateFor } from "./comps";

/**
 * Chronos (S29) — turn a marketplace order into unit writes. PURE: no Prisma
 * import, following margin.ts and thor/health.ts.
 *
 * This is the shared core. The eBay adapter produces `ConnectorOrder`s from the
 * Sell APIs and the manual-marketplace CSV importer produces them from a
 * spreadsheet; both then come through here, so the fee arithmetic and the
 * idempotency keys are written and tested once rather than twice.
 *
 * Two rules it exists to enforce:
 *
 *  1. **Dedupe keys are deterministic.** Every cost line carries a key derived
 *     from the upstream order, so re-syncing an overlapping window converges
 *     through addUnitCost's @@unique([unitId, dedupeKey]) upsert instead of
 *     double-booking the fees. A random key here would silently disable the
 *     single most load-bearing constraint in the Chronos design.
 *
 *  2. **Never guess a match.** A line matches a unit by SKU or it does not. An
 *     unmatched line produces NO writes and is surfaced for a human to
 *     reconcile. A wrong match corrupts two units' margins at once and is far
 *     harder to notice than a queue item.
 */

/** UnitCost kinds a marketplace fee may legitimately map onto. */
export const FEE_KINDS = [
  "MARKETPLACE_FEE",
  "PAYMENT_FEE",
  "SHIPPING_OUT",
  "DUTY",
  "REFUND",
  "OTHER",
] as const;

export type FeeKind = (typeof FEE_KINDS)[number];

/**
 * Upstream fee codes → Chronos cost kinds.
 *
 * Keys are matched case-insensitively after stripping non-alphanumerics, so
 * "FINAL_VALUE_FEE", "finalValueFee" and "Final Value Fee" all land together —
 * marketplaces are not consistent about this, and a CSV export is less
 * consistent still. Anything unrecognised becomes OTHER and still lands on the
 * unit: an unknown fee is a real cost, and dropping it would overstate margin.
 */
const FEE_CODE_MAP: Record<string, FeeKind> = {
  // eBay managed payments (Finances API `feeType` values)
  finalvaluefee: "MARKETPLACE_FEE",
  finalvaluefeefixedperorder: "MARKETPLACE_FEE",
  insertionfee: "MARKETPLACE_FEE",
  internationalfee: "MARKETPLACE_FEE",
  regulatoryoperatingfee: "MARKETPLACE_FEE",
  adfee: "MARKETPLACE_FEE",
  adfeelite: "MARKETPLACE_FEE",
  promotedlistingfee: "MARKETPLACE_FEE",
  storesubscriptionfee: "OTHER",
  paymentprocessingfee: "PAYMENT_FEE",
  paymentsprocessingfee: "PAYMENT_FEE",
  // Shipping the seller paid
  shippinglabel: "SHIPPING_OUT",
  shippingcost: "SHIPPING_OUT",
  shipping: "SHIPPING_OUT",
  // Cross-border
  importcharges: "DUTY",
  duty: "DUTY",
  customs: "DUTY",
  // Money going back out
  refund: "REFUND",
  return: "REFUND",
  // Already-normalised kinds pass straight through
  marketplacefee: "MARKETPLACE_FEE",
  paymentfee: "PAYMENT_FEE",
  shippingout: "SHIPPING_OUT",
  other: "OTHER",
};

export function normaliseFeeKind(raw: string): FeeKind {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return FEE_CODE_MAP[key] ?? "OTHER";
}

/** Cost line to write, minus the unitId the caller resolves by SKU. */
export interface PendingCost {
  kind: FeeKind;
  label: string;
  amountCents: number;
  currency: string;
  fxRate: number;
  incurredAt: Date;
  source: string;
  dedupeKey: string;
}

/** Sale-side facts to stamp onto the matched InventoryUnit. */
export interface PendingSale {
  soldAt: Date;
  soldOn: string;
  saleExternalId: string;
  salePriceCents: number;
  saleCurrency: string;
  saleFxRate: number;
}

export interface MatchedLine {
  sku: string;
  sale: PendingSale;
  costs: PendingCost[];
}

export type UnmatchedReason = "no_sku" | "multi_quantity";

export interface UnmatchedLine {
  reason: UnmatchedReason;
  sku: string | null;
  title: string;
  quantity: number;
  grossCents: number;
  currency: string;
}

export interface MapOrderOptions {
  /** Marketplace key — namespaces every dedupe key. */
  provider: string;
  baseCurrency: string;
  /** currency → multiplier to base. Missing/1 means 1:1. */
  fxRates?: Record<string, number>;
  /** UnitCost.source for the produced lines. */
  source?: string;
}

export interface MappedOrder {
  externalId: string;
  matched: MatchedLine[];
  unmatched: UnmatchedLine[];
}

// Delegates to comps.ts (S30) so the order-sync and comp-ingest paths can never
// disagree about a conversion — the same price would otherwise land in a unit's
// margin and in its reference's band at two different base amounts.
function fxRateFor(currency: string, opts: MapOrderOptions): number {
  return baseFxRateFor(currency, opts.baseCurrency, opts.fxRates);
}

/**
 * Fee amounts arrive as positive magnitudes; a marketplace that reports a
 * credit as negative would otherwise reach addUnitCost, which rejects negative
 * amounts outright (kind carries the sign, not the number).
 */
function feeAmountCents(fee: ConnectorFee): number {
  return Math.abs(Math.round(fee.amountCents));
}

function mapLine(
  order: ConnectorOrder,
  line: ConnectorOrderLine,
  index: number,
  opts: MapOrderOptions,
): MatchedLine | UnmatchedLine {
  const sku = line.sku?.trim();
  if (!sku) {
    return {
      reason: "no_sku",
      sku: null,
      title: line.title,
      quantity: line.quantity,
      grossCents: line.grossCents,
      currency: line.currency || order.currency,
    };
  }

  // One InventoryUnit is one physical item. A line selling two of a SKU cannot
  // be attributed to a single unit, and splitting it would be a guess.
  if (line.quantity > 1) {
    return {
      reason: "multi_quantity",
      sku,
      title: line.title,
      quantity: line.quantity,
      grossCents: line.grossCents,
      currency: line.currency || order.currency,
    };
  }

  const currency = (line.currency || order.currency).toUpperCase();
  const fxRate = fxRateFor(currency, opts);
  const source = opts.source ?? "EBAY_ORDER";
  const keyBase = `${opts.provider}:${order.externalId}:${index}`;

  // Group by kind so repeated codes (two ad fees, say) get stable ordinals
  // rather than shifting keys when the upstream array order changes.
  const perKind = new Map<FeeKind, number>();
  const costs: PendingCost[] = line.fees.map((fee) => {
    const kind = normaliseFeeKind(fee.kind);
    const ordinal = perKind.get(kind) ?? 0;
    perKind.set(kind, ordinal + 1);
    const feeCurrency = (fee.currency || currency).toUpperCase();
    return {
      kind,
      label: fee.label || kind,
      amountCents: feeAmountCents(fee),
      currency: feeCurrency,
      fxRate: fxRateFor(feeCurrency, opts),
      incurredAt: order.soldAt,
      source,
      dedupeKey: `${keyBase}:${kind.toLowerCase()}:${ordinal}`,
    };
  });

  return {
    sku,
    sale: {
      soldAt: order.soldAt,
      soldOn: opts.provider,
      saleExternalId: order.externalId,
      salePriceCents: Math.round(line.grossCents),
      saleCurrency: currency,
      saleFxRate: fxRate,
    },
    costs,
  };
}

function isUnmatched(v: MatchedLine | UnmatchedLine): v is UnmatchedLine {
  return "reason" in v;
}

export function mapOrderToUnitWrites(
  order: ConnectorOrder,
  opts: MapOrderOptions,
): MappedOrder {
  const results = order.lines.map((line, i) => mapLine(order, line, i, opts));
  return {
    externalId: order.externalId,
    matched: results.filter((r): r is MatchedLine => !isUnmatched(r)),
    unmatched: results.filter(isUnmatched),
  };
}

/** Total fees on a mapped line, in base currency — for previews and reports. */
export function totalFeesBaseCents(line: MatchedLine): number {
  return line.costs.reduce(
    (sum, c) => sum + Math.round(c.amountCents * (c.fxRate > 0 ? c.fxRate : 1)),
    0,
  );
}

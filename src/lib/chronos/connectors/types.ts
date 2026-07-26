// Chronos marketplace connector contract (S27, implemented S29).
//
// One adapter per marketplace. Defined ahead of the implementation because the
// CAPABILITIES are a product fact, not an implementation detail: Chrono24,
// Vinted and LeBonCoin have no public API at all, so "manual" is a state the
// settings UI must render — "Chrono24 : saisie manuelle" — without
// instantiating any behaviour. That is why capabilities are a plain data object
// rather than Freyja's optional-method-presence check (see connectors/index.ts,
// which has a test asserting the two can never drift apart).
//
// The hard external constraint this encodes: eBay's Marketplace Insights API
// (sold comps) is Limited Release and denied to non-major-partners, and the
// Finding API died in early 2025. So `soldComps` is false on every provider and
// is expected to stay that way. Asking prices from `searchListings` must NEVER
// be rendered as sold comps — the comp DB (S30) is built from the seller's own
// completed sales, which are authoritative and carry real fees.

export interface ConnectorCtx {
  tenantId: string;
}

/**
 * What an adapter can actually do. Every flag has a matching optional method;
 * a true flag without its method is a bug the registry test catches.
 */
export interface ConnectorCapabilities {
  /** Active/asking listings — available on eBay Browse with an app token. */
  searchListings: boolean;
  /** Completed-sale comps. Gated everywhere; assume permanently false. */
  soldComps: boolean;
  /** The seller's own listings — needs user OAuth. */
  ownListings: boolean;
  /** The seller's own orders WITH the real fee breakdown. The valuable one. */
  ownOrders: boolean;
}

/** An asking-price observation. Never a sold price — see the header. */
export interface ConnectorListing {
  externalId: string;
  title: string;
  /** Integer minor units of `currency`. */
  priceCents: number;
  currency: string;
  condition?: string;
  url?: string;
  observedAt: Date;
}

/** A completed sale, from the seller's own account. Authoritative. */
export interface ConnectorSoldComp {
  externalId: string;
  title: string;
  soldPriceCents: number;
  currency: string;
  soldAt: Date;
}

/**
 * One fee line on an order, mapped onto a UnitCost kind by the S29 sync.
 * This array is the whole point of the interface: it is what puts the real
 * marketplace and payment fees on a unit instead of an estimate.
 */
export interface ConnectorFee {
  /** MARKETPLACE_FEE | PAYMENT_FEE | SHIPPING_OUT | DUTY | OTHER */
  kind: string;
  label: string;
  /** Always positive; `kind` carries the sign semantics, as with UnitCost. */
  amountCents: number;
  currency: string;
}

export interface ConnectorOrderLine {
  /**
   * The listing's custom label. Present only if the seller set one — matching
   * is therefore best-effort, and an unmatched line must go to a reconciliation
   * queue rather than being guessed onto a unit (S29).
   */
  sku: string | null;
  title: string;
  quantity: number;
  grossCents: number;
  currency: string;
  fees: ConnectorFee[];
}

export interface ConnectorOrder {
  externalId: string;
  soldAt: Date;
  currency: string;
  grossCents: number;
  lines: ConnectorOrderLine[];
}

export interface ConnectorOwnListing {
  externalId: string;
  sku: string | null;
  title: string;
  askPriceCents: number;
  currency: string;
  listedAt: Date;
}

export interface MarketplaceConnector {
  provider: string;
  capabilities: ConnectorCapabilities;
  searchListings?(ctx: ConnectorCtx, query: string): Promise<ConnectorListing[]>;
  fetchSoldComps?(ctx: ConnectorCtx, query: string): Promise<ConnectorSoldComp[]>;
  fetchOwnListings?(ctx: ConnectorCtx): Promise<ConnectorOwnListing[]>;
  fetchOwnOrders?(ctx: ConnectorCtx, since: Date): Promise<ConnectorOrder[]>;
}

/** The methods each capability flag promises. Used by the drift test. */
export const CAPABILITY_METHODS = {
  searchListings: "searchListings",
  soldComps: "fetchSoldComps",
  ownListings: "fetchOwnListings",
  ownOrders: "fetchOwnOrders",
} as const satisfies Record<keyof ConnectorCapabilities, keyof MarketplaceConnector>;

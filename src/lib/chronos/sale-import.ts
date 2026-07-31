import { normalizeHeader } from "@/lib/import/mapping";
import { toDate } from "@/lib/import/coerce";
import { toCents } from "./margin";
import type { ConnectorFee, ConnectorOrder } from "./connectors/types";

/**
 * Chronos (S29) — manual-marketplace sale import. PURE: no Prisma, no I/O.
 *
 * Chrono24, Vinted and LeBonCoin have no public API, so his sales there arrive
 * as a spreadsheet. Rather than a second write path, a CSV row is normalised
 * into the SAME `ConnectorOrder` the eBay adapter produces and handed to
 * sync-map.ts — so fee arithmetic, currency handling, dedupe keys and the
 * never-guess-a-match rule are shared and tested once.
 *
 * Deliberately NOT an extension of the S13b import engine: `ImportEntity` there
 * is hardcoded to COMPANY|CONTACT|DEAL, `dedupe.ts` is SIRET-centric, and
 * `ImportRecord.rowKey` *is* the company upsert key. What IS reused is the
 * genuinely generic half — csv.ts's parser, coerce.ts's scalars, and
 * normalizeHeader for synonym matching.
 *
 * No run-tracking model either: idempotency already comes from the deterministic
 * dedupe keys and the MarketplaceOrder unique, so re-applying a file converges.
 */

export type SaleColumn =
  | "sku"
  | "externalId"
  | "soldAt"
  | "grossAmount"
  | "currency"
  | "marketplaceFee"
  | "paymentFee"
  | "shippingOut"
  | "duty"
  | "title";

export interface SaleTarget {
  key: SaleColumn;
  label: string;
  required: boolean;
  synonyms: string[];
}

/** Column vocabulary. Synonyms cover FR and EN exports of the usual suspects. */
export const SALE_TARGETS: SaleTarget[] = [
  {
    key: "sku",
    label: "SKU / référence interne",
    required: true,
    synonyms: ["sku", "reference interne", "ref interne", "custom label", "code article", "reference"],
  },
  {
    key: "externalId",
    label: "N° de commande",
    required: true,
    synonyms: ["numero de commande", "n commande", "order id", "order number", "commande", "transaction id"],
  },
  {
    key: "soldAt",
    label: "Date de vente",
    required: true,
    synonyms: ["date de vente", "date vente", "sold date", "sale date", "date", "date de transaction"],
  },
  {
    key: "grossAmount",
    label: "Montant brut",
    required: true,
    synonyms: ["montant brut", "prix de vente", "montant", "gross", "sale price", "total", "prix"],
  },
  { key: "currency", label: "Devise", required: false, synonyms: ["devise", "currency", "monnaie"] },
  {
    key: "marketplaceFee",
    label: "Commission marketplace",
    required: false,
    synonyms: ["commission", "frais marketplace", "frais de vente", "marketplace fee", "final value fee", "commission site"],
  },
  {
    key: "paymentFee",
    label: "Frais de paiement",
    required: false,
    synonyms: ["frais de paiement", "payment fee", "frais paiement", "commission paiement"],
  },
  {
    key: "shippingOut",
    label: "Frais de port (sortant)",
    required: false,
    synonyms: ["frais de port", "port", "shipping", "livraison", "frais expedition"],
  },
  {
    key: "duty",
    label: "Douane / taxes",
    required: false,
    synonyms: ["douane", "duty", "taxes", "customs", "import"],
  },
  { key: "title", label: "Libellé", required: false, synonyms: ["libelle", "titre", "title", "article", "designation", "produit"] },
];

export type SaleMapping = Partial<Record<SaleColumn, string>>;

/**
 * Best-effort header → column suggestion. Exact normalised match first, then a
 * synonym hit, then a containment fallback. Deterministic — no AI, same posture
 * as S13b's mapping step.
 */
export function suggestSaleMapping(headers: string[]): SaleMapping {
  const mapping: SaleMapping = {};
  const taken = new Set<string>();

  for (const target of SALE_TARGETS) {
    const candidates = [normalizeHeader(target.label), ...target.synonyms.map(normalizeHeader)];

    const exact = headers.find(
      (h) => !taken.has(h) && candidates.includes(normalizeHeader(h)),
    );
    if (exact) {
      mapping[target.key] = exact;
      taken.add(exact);
      continue;
    }

    const partial = headers.find((h) => {
      if (taken.has(h)) return false;
      const n = normalizeHeader(h);
      return candidates.some((c) => c.length > 3 && (n.includes(c) || c.includes(n)));
    });
    if (partial) {
      mapping[target.key] = partial;
      taken.add(partial);
    }
  }

  return mapping;
}

export function missingRequiredColumns(mapping: SaleMapping): SaleColumn[] {
  return SALE_TARGETS.filter((t) => t.required && !mapping[t.key]).map((t) => t.key);
}

export interface SaleRowError {
  rowNumber: number;
  message: string;
}

export interface ParsedSaleRows {
  orders: ConnectorOrder[];
  errors: SaleRowError[];
}

const FEE_COLUMNS: Array<{ column: SaleColumn; kind: string; label: string }> = [
  { column: "marketplaceFee", kind: "MARKETPLACE_FEE", label: "Commission marketplace" },
  { column: "paymentFee", kind: "PAYMENT_FEE", label: "Frais de paiement" },
  { column: "shippingOut", kind: "SHIPPING_OUT", label: "Frais de port" },
  { column: "duty", kind: "DUTY", label: "Douane" },
];

function cell(row: Record<string, string>, mapping: SaleMapping, column: SaleColumn): string {
  const header = mapping[column];
  return header ? (row[header] ?? "").trim() : "";
}

/**
 * CSV rows → ConnectorOrders, one order per row.
 *
 * A row that cannot produce a usable order is reported as an error and
 * contributes nothing — a half-parsed sale would corrupt a margin, and the
 * whole point of the dry run is to see these before anything is written.
 */
export function parseSaleRows(
  rows: Array<Record<string, string>>,
  mapping: SaleMapping,
  opts: { defaultCurrency?: string } = {},
): ParsedSaleRows {
  const orders: ConnectorOrder[] = [];
  const errors: SaleRowError[] = [];
  const defaultCurrency = (opts.defaultCurrency ?? "EUR").toUpperCase();

  rows.forEach((row, i) => {
    // +2: one for the header row, one because humans count from 1.
    const rowNumber = i + 2;

    const sku = cell(row, mapping, "sku");
    const externalId = cell(row, mapping, "externalId");
    const soldAtRaw = cell(row, mapping, "soldAt");
    const grossRaw = cell(row, mapping, "grossAmount");

    if (!sku && !externalId && !grossRaw) return; // blank trailing row

    if (!externalId) {
      errors.push({ rowNumber, message: "N° de commande manquant" });
      return;
    }
    const soldAt = toDate(soldAtRaw);
    if (!soldAt) {
      errors.push({ rowNumber, message: `Date de vente illisible : « ${soldAtRaw} »` });
      return;
    }
    const grossCents = toCents(grossRaw);
    if (grossCents === null) {
      errors.push({ rowNumber, message: `Montant illisible : « ${grossRaw} »` });
      return;
    }

    const currency = (cell(row, mapping, "currency") || defaultCurrency).toUpperCase();

    const fees: ConnectorFee[] = [];
    for (const fee of FEE_COLUMNS) {
      const raw = cell(row, mapping, fee.column);
      if (!raw) continue;
      const cents = toCents(raw);
      if (cents === null) {
        errors.push({ rowNumber, message: `${fee.label} illisible : « ${raw} »` });
        return;
      }
      if (cents === 0) continue;
      fees.push({
        kind: fee.kind,
        label: fee.label,
        amountCents: Math.abs(cents),
        currency,
      });
    }

    orders.push({
      externalId,
      soldAt,
      currency,
      grossCents,
      lines: [
        {
          // Empty SKU stays null so sync-map routes it to reconciliation
          // rather than this parser inventing a match.
          sku: sku || null,
          title: cell(row, mapping, "title") || sku,
          quantity: 1,
          grossCents,
          currency,
          fees,
        },
      ],
    });
  });

  return { orders, errors };
}

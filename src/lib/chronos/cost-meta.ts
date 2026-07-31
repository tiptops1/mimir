import { COST_KINDS, type CostGroup } from "./margin";

/**
 * Chronos (S27b) — display vocabulary for the cost ledger. Client-safe: no
 * Prisma, no server-only import, so filter bars and inline forms can import it.
 *
 * Unlike unit STATUSES (INVENTORY_UNIT stage rows, tenant-editable config), cost
 * kinds are code: COST_GROUPS in margin.ts buckets the waterfall by them, so a
 * tenant renaming one would silently break the margin math. Only their labels
 * live here.
 */

const KIND_LABELS: Record<string, string> = {
  ACQUISITION: "Achat",
  PART: "Pièce détachée",
  CONSUMABLE: "Consommable",
  LABOUR: "Main-d'œuvre",
  TOOL_ALLOCATION: "Outillage",
  SHIPPING_IN: "Port entrant",
  SHIPPING_OUT: "Port sortant",
  DUTY: "Douane",
  MARKETPLACE_FEE: "Commission marketplace",
  PAYMENT_FEE: "Frais de paiement",
  REFUND: "Remboursement",
  OTHER: "Autre",
};

export function costKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export const COST_KIND_OPTIONS: { value: string; label: string }[] =
  COST_KINDS.map((value) => ({ value, label: costKindLabel(value) }));

/** Waterfall row headings, in the order the waterfall renders them. */
export const COST_GROUP_LABELS: Record<CostGroup, string> = {
  acquisition: "Achat",
  restoration: "Restauration",
  logistics: "Logistique",
  fees: "Frais de vente",
  refunds: "Remboursements",
  other: "Autres coûts",
};

export const COST_GROUP_ORDER: CostGroup[] = [
  "acquisition",
  "restoration",
  "logistics",
  "fees",
  "refunds",
  "other",
];

export const VAT_SCHEME_OPTIONS: { value: string; label: string }[] = [
  { value: "MARGIN", label: "Régime de la marge" },
  { value: "STANDARD", label: "TVA standard" },
  { value: "EXEMPT", label: "Exonéré" },
];

export function vatSchemeLabel(scheme: string): string {
  return VAT_SCHEME_OPTIONS.find((o) => o.value === scheme)?.label ?? scheme;
}

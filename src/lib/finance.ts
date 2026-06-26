// Client-safe finance metadata + math (no DB imports), mirroring stage-meta.ts.
// Server code (actions / pages / cron) and "use client" components both import
// from here, so it must stay free of the tenant DB router.

export type FinanceDirection = "OUT" | "IN";
export type FinanceKind = "SUBSCRIPTION" | "STAFF" | "EXPENSE" | "INVOICE";
export type Recurrence = "NONE" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

export const FINANCE_KINDS: Array<{
  value: FinanceKind;
  label: string;
  plural: string;
  direction: FinanceDirection;
  badge: string;
}> = [
  { value: "SUBSCRIPTION", label: "Abonnement", plural: "Abonnements", direction: "OUT", badge: "bg-indigo-100 text-indigo-700" },
  { value: "STAFF", label: "Personnel", plural: "Personnel", direction: "OUT", badge: "bg-violet-100 text-violet-700" },
  { value: "EXPENSE", label: "Dépense", plural: "Dépenses", direction: "OUT", badge: "bg-surface-2 text-muted" },
  { value: "INVOICE", label: "Facture", plural: "Factures", direction: "IN", badge: "bg-emerald-100 text-emerald-700" },
];

export const KIND_META: Record<FinanceKind, (typeof FINANCE_KINDS)[number]> =
  Object.fromEntries(FINANCE_KINDS.map((k) => [k.value, k])) as Record<
    FinanceKind,
    (typeof FINANCE_KINDS)[number]
  >;

// Starter categories — also seeded as the FieldDefinition "FINANCE" category
// select (scripts/seed-config.ts), so they're editable as config. Used as a
// fallback when the config row hasn't been seeded yet.
export const DEFAULT_FINANCE_CATEGORIES = [
  "Logiciels",
  "Marketing",
  "Bureau",
  "Matériel",
  "Sous-traitance",
  "Banque · frais",
  "Impôts · taxes",
  "Déplacements",
  "Revenu",
  "Autre",
];

export const RECURRENCE_OPTIONS: Array<{ value: Recurrence; label: string }> = [
  { value: "NONE", label: "Ponctuel" },
  { value: "MONTHLY", label: "Mensuel" },
  { value: "QUARTERLY", label: "Trimestriel" },
  { value: "ANNUAL", label: "Annuel" },
];

export const RECURRENCE_LABELS: Record<string, string> = Object.fromEntries(
  RECURRENCE_OPTIONS.map((r) => [r.value, r.label]),
);

// Status values are kind-dependent (a cost is ACTIVE/TRIAL/…, an invoice is
// DRAFT/SENT/…). Keys are unique across both sets, so one table covers all.
export interface StatusMeta {
  value: string;
  label: string;
  badge: string;
}

const COST_STATUSES: StatusMeta[] = [
  { value: "ACTIVE", label: "Actif", badge: "bg-emerald-100 text-emerald-700" },
  { value: "TRIAL", label: "Essai", badge: "bg-rose-100 text-rose-700" },
  { value: "PAUSED", label: "En pause", badge: "bg-amber-100 text-amber-700" },
  { value: "CANCELLED", label: "Annulé", badge: "bg-surface-2 text-muted" },
];

const INVOICE_STATUSES: StatusMeta[] = [
  { value: "DRAFT", label: "Brouillon", badge: "bg-surface-2 text-muted" },
  { value: "SENT", label: "Envoyée", badge: "bg-sky-100 text-sky-700" },
  { value: "PAID", label: "Payée", badge: "bg-emerald-100 text-emerald-700" },
  { value: "OVERDUE", label: "En retard", badge: "bg-rose-100 text-rose-700" },
];

export const STATUS_META: Record<string, StatusMeta> = Object.fromEntries(
  [...COST_STATUSES, ...INVOICE_STATUSES].map((s) => [s.value, s]),
);

/** The valid status choices for a kind — drives the form + inline editor. */
export function statusOptionsFor(kind: FinanceKind): StatusMeta[] {
  return kind === "INVOICE" ? INVOICE_STATUSES : COST_STATUSES;
}

/** The default status when creating an entry of a kind. */
export function defaultStatusFor(kind: FinanceKind): string {
  return kind === "INVOICE" ? "DRAFT" : "ACTIVE";
}

export function kindDirection(kind: FinanceKind): FinanceDirection {
  return KIND_META[kind]?.direction ?? "OUT";
}

// Statuses that mean "no longer a live recurring line" — excluded from run-rate.
const DEAD_STATUSES = new Set(["CANCELLED", "PAUSED", "DRAFT"]);

/** Normalize an entry's amount to a per-month figure (NONE → 0, ANNUAL → /12). */
export function monthlyAmount(e: {
  amount: number;
  recurrence: string;
}): number {
  switch (e.recurrence) {
    case "MONTHLY":
      return e.amount;
    case "QUARTERLY":
      return e.amount / 3;
    case "ANNUAL":
      return e.amount / 12;
    default:
      return 0; // NONE — one-off, not part of the run-rate
  }
}

/** A recurring, still-live line that counts toward the monthly run-rate. */
export function countsInRunRate(e: {
  recurrence: string;
  status: string;
}): boolean {
  return e.recurrence !== "NONE" && !DEAD_STATUSES.has(e.status);
}

// Serializable row passed from server components to "use client" components
// (Dates → ISO strings, company flattened to {id,name}).
export interface FinanceRow {
  id: string;
  direction: FinanceDirection;
  kind: FinanceKind;
  label: string;
  vendor: string | null;
  category: string | null;
  amount: number;
  currency: string;
  recurrence: Recurrence;
  status: string;
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  trialEndsAt: string | null;
  renewsAt: string | null;
  dueDate: string | null;
  autoRenew: boolean;
  notes: string | null;
  company: { id: string; name: string } | null;
}

import { formatCents } from "@/lib/display";
import { COST_GROUP_LABELS, COST_GROUP_ORDER, vatSchemeLabel } from "@/lib/chronos/cost-meta";
import type { UnitMargin } from "@/lib/chronos/margin";

/**
 * True margin, broken down. Pure presentation over the UnitMargin computeUnitMargin
 * already produced — no arithmetic here beyond the bar widths, so the page and
 * the cockpit can never disagree about a figure.
 *
 * A unit in stock has no revenue and no margin yet; the waterfall then reads as
 * "what this has cost so far", with the sale rows suppressed rather than zeroed.
 */

function Row({
  label,
  cents,
  width,
  tone = "cost",
  hint,
}: {
  label: string;
  cents: number;
  width: number;
  tone?: "revenue" | "cost" | "vat";
  hint?: string;
}) {
  const bar =
    tone === "revenue" ? "bg-realm" : tone === "vat" ? "bg-realm-2" : "bg-realm/45";
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <span className="block truncate text-sm text-foreground">{label}</span>
        {hint && <span className="block truncate text-xs text-faint">{hint}</span>}
      </div>
      <div className="h-2 rounded-full bg-surface-2">
        <div
          className={`h-2 rounded-full ${bar}`}
          style={{ width: `${Math.min(100, Math.max(0, width))}%` }}
        />
      </div>
      <span className="text-right text-sm tnum text-muted">
        {tone === "revenue" ? formatCents(cents) : `− ${formatCents(cents)}`}
      </span>
    </div>
  );
}

export function MarginWaterfall({
  margin,
  vatScheme,
}: {
  margin: UnitMargin;
  vatScheme: string;
}) {
  const groups = COST_GROUP_ORDER.map((g) => ({
    group: g,
    label: COST_GROUP_LABELS[g],
    cents: margin.groups[g],
  })).filter((g) => g.cents > 0);

  // Bars are read against the larger of revenue and total outlay, so an
  // underwater unit's costs still fill the row rather than overflowing it.
  const scale = Math.max(
    margin.revenueCents,
    margin.totalCostCents + margin.vatCents,
    1,
  );
  const pct = (c: number) => (c / scale) * 100;
  const negative = margin.netMarginCents < 0;

  return (
    <div className="space-y-1">
      {margin.sold ? (
        <Row
          label="Prix de vente"
          cents={margin.revenueCents}
          width={pct(margin.revenueCents)}
          tone="revenue"
        />
      ) : (
        <p className="pb-2 text-xs text-muted">
          Pièce encore en stock — le prix de vente et la marge apparaîtront une
          fois la vente enregistrée.
        </p>
      )}

      {groups.map((g) => (
        <Row
          key={g.group}
          label={g.label}
          cents={g.cents}
          width={pct(g.cents)}
        />
      ))}

      {margin.vatCents > 0 && (
        <Row
          label="TVA"
          cents={margin.vatCents}
          width={pct(margin.vatCents)}
          tone="vat"
          hint={vatSchemeLabel(vatScheme)}
        />
      )}

      <div className="mt-2 flex items-baseline justify-between border-t border-border pt-3">
        <span className="text-sm font-medium text-foreground">
          {margin.sold ? "Marge nette" : "Coût de revient"}
        </span>
        <span
          className={`text-xl font-semibold tracking-tight tnum ${
            !margin.sold ? "text-foreground" : negative ? "text-danger" : "text-success"
          }`}
        >
          {margin.sold
            ? formatCents(margin.netMarginCents)
            : formatCents(margin.totalCostCents)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-3">
        <div>
          <p className="text-sm tnum text-foreground">
            {margin.marginPct === null ? "—" : `${margin.marginPct} %`}
          </p>
          <p className="text-xs text-muted">Marge</p>
        </div>
        <div>
          <p className="text-sm tnum text-foreground">
            {margin.daysHeld === null ? "—" : `${margin.daysHeld} j`}
          </p>
          <p className="text-xs text-muted">
            {margin.sold ? "Détenue" : "En stock depuis"}
          </p>
        </div>
        <div>
          <p className="text-sm tnum text-foreground">
            {margin.marginPerDayCents === null
              ? formatCents(margin.cashTiedUpCents)
              : formatCents(margin.marginPerDayCents)}
          </p>
          <p className="text-xs text-muted">
            {margin.marginPerDayCents === null
              ? "Capital immobilisé"
              : "Marge / jour"}
          </p>
        </div>
      </div>
    </div>
  );
}

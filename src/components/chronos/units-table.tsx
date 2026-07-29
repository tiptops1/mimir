import { ViewTransition } from "react";
import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { EnumCell, type EnumOption } from "@/components/enum-cell";
import { setUnitEnum } from "@/app/actions/chronos";
import { formatCents, formatPct } from "@/lib/display";
import { formatDate } from "@/lib/utils";
import type { UnitMarginRow } from "@/lib/chronos/inventory";
import type { UnitStageDef } from "@/lib/chronos/unit-stage-meta";

/**
 * The inventory list. A plain (non-async) component, unlike companies-table.tsx:
 * margin is derived from the cost ledger, so the page has to load, filter and
 * slice before anything can be rendered — there is no where-clause to hand down.
 */

/** Margin figures are only meaningful once a unit has actually sold. */
function marginTone(sold: boolean, cents: number): string {
  if (!sold) return "text-faint";
  return cents < 0 ? "text-danger" : "text-foreground";
}

export function UnitsTable({
  rows,
  stages,
}: {
  rows: UnitMarginRow[];
  stages: UnitStageDef[];
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Aucune pièce trouvée"
        hint="Ajustez vos filtres ou ajoutez une nouvelle pièce."
      />
    );
  }

  const stageOptions: EnumOption[] = stages.map((s) => ({
    value: s.value,
    label: s.label,
    badge: s.badge,
    dot: s.dot,
  }));

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2.5 font-semibold">SKU</th>
              <th className="px-4 py-2.5 font-semibold">Référence</th>
              <th className="px-4 py-2.5 font-semibold">Statut</th>
              <th className="px-4 py-2.5 font-semibold">Acquise</th>
              <th className="px-4 py-2.5 text-right font-semibold">Coût</th>
              <th className="px-4 py-2.5 text-right font-semibold">Vente</th>
              <th className="px-4 py-2.5 text-right font-semibold">Marge</th>
              <th className="px-4 py-2.5 text-right font-semibold">Marge %</th>
              <th className="px-4 py-2.5 text-right font-semibold">€ / jour</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ unit, margin }) => (
              <tr
                key={unit.id}
                className="border-b border-border last:border-0 align-top transition-colors hover:bg-surface-2/70"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/chronos/${unit.id}`}
                    className="block"
                    transitionTypes={["nav-forward"]}
                  >
                    <ViewTransition name={`unit-${unit.id}`}>
                      <span className="font-medium text-foreground hover:text-realm">
                        {unit.sku}
                      </span>
                    </ViewTransition>
                    {unit.serial && (
                      <span className="mt-0.5 block text-xs text-faint tnum">
                        {unit.serial}
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="text-foreground">{unit.ref.brand}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {[unit.ref.reference, unit.ref.model, unit.ref.variant]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <EnumCell
                    id={unit.id}
                    field="status"
                    value={unit.status}
                    options={stageOptions}
                    action={setUnitEnum}
                  />
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className="text-muted tnum">{formatDate(unit.acquiredAt)}</span>
                  {margin.daysHeld !== null && (
                    <span className="mt-0.5 block text-faint tnum">
                      {margin.daysHeld} j
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tnum text-muted">
                  {formatCents(margin.totalCostCents)}
                </td>
                <td className="px-4 py-3 text-right tnum text-muted">
                  {margin.sold ? formatCents(margin.revenueCents) : "—"}
                </td>
                <td
                  className={`px-4 py-3 text-right font-medium tnum ${marginTone(
                    margin.sold,
                    margin.netMarginCents,
                  )}`}
                >
                  {margin.sold ? formatCents(margin.netMarginCents) : "—"}
                </td>
                <td
                  className={`px-4 py-3 text-right tnum ${marginTone(
                    margin.sold,
                    margin.netMarginCents,
                  )}`}
                >
                  {formatPct(margin.marginPct)}
                </td>
                <td className="px-4 py-3 text-right tnum text-muted">
                  {margin.marginPerDayCents === null
                    ? "—"
                    : formatCents(margin.marginPerDayCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

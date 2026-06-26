import { CashOnHandCard } from "@/components/cash-on-hand-card";
import { formatCurrency } from "@/lib/display";
import type { FinanceCockpit } from "@/lib/finance-cockpit";

// The four cockpit KPI cards (revenue / costs / net / trésorerie+runway).
// Shared by the Finances page and the dashboard P&L strip.
export function FinanceKpiStrip({
  cockpit,
  cash,
}: {
  cockpit: FinanceCockpit;
  cash: number | null;
}) {
  const positive = cockpit.net >= 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <p className="text-xs text-muted">Revenu ce mois</p>
        <p className="mt-0.5 text-2xl font-semibold text-emerald-700">
          {formatCurrency(cockpit.incomeThisMonth)}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Pipeline ouvert {formatCurrency(cockpit.openPipeline)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <p className="text-xs text-muted">Coûts ce mois</p>
        <p className="mt-0.5 text-2xl font-semibold">
          {formatCurrency(cockpit.costThisMonth)}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Récurrent {formatCurrency(cockpit.costRunRate)}/mois
        </p>
      </div>
      <div
        className={`rounded-xl border p-5 shadow-sm ${
          positive
            ? "border-emerald-200 bg-emerald-50"
            : "border-rose-200 bg-rose-50"
        }`}
      >
        <p className={`text-xs ${positive ? "text-emerald-700" : "text-rose-700"}`}>
          Net mensuel
        </p>
        <p
          className={`mt-0.5 text-2xl font-semibold ${
            positive ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {positive ? "+" : ""}
          {formatCurrency(cockpit.net)}
        </p>
        <p className={`mt-0.5 text-xs ${positive ? "text-emerald-700" : "text-rose-700"}`}>
          {cockpit.incomeThisMonth > 0
            ? `Marge ${Math.round((cockpit.net / cockpit.incomeThisMonth) * 100)} %`
            : "Revenu à enregistrer"}
        </p>
      </div>
      <CashOnHandCard cash={cash} monthlyNet={cockpit.net} />
    </div>
  );
}

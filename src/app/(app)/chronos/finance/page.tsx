import Link from "next/link";
import { Info } from "lucide-react";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { Donut, PnlChart } from "@/components/charts";
import { loadUnitsWithMargins, loadVatConfig } from "@/lib/chronos/inventory";
import { readMarketplaces, readTargetMarginPct } from "@/lib/chronos/config";
import {
  COST_GROUP_LABELS,
  COST_GROUP_ORDER,
  vatSchemeLabel,
} from "@/lib/chronos/cost-meta";
import {
  byMarketplace,
  cashPosition,
  costBreakdown,
  extremes,
  financeKpis,
  FINANCE_PERIODS,
  inPeriod,
  isFinancePeriod,
  monthlyPnl,
  periodStart,
  type FinancePeriod,
  type SoldUnit,
} from "@/lib/chronos/finance";
import { formatCents, formatPct } from "@/lib/display";
import { str } from "@/lib/list-filters";
import { cn } from "@/lib/utils";

/**
 * Chronos → Finances.
 *
 * Every figure on this page is DERIVED from the unit cost ledger — there is no
 * separate books-keeping store to drift from it. One load of units-with-margins
 * feeds all six surfaces below (see chronos/inventory.ts for why margin can't
 * be filtered in Prisma), and the aggregation itself is pure and unit-tested in
 * chronos/finance.ts.
 *
 * The period selector governs REALISED money only. The cash-position card is
 * deliberately outside it — see the note at the top of chronos/finance.ts.
 */

const DEFAULT_PERIOD: FinancePeriod = "12m";

export default async function ChronosFinancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();
  const sp = await searchParams;

  const raw = str(sp, "periode");
  const period: FinancePeriod = isFinancePeriod(raw) ? raw : DEFAULT_PERIOD;

  const [vat, marketplaces, targetMarginPct] = await Promise.all([
    loadVatConfig(prisma),
    readMarketplaces(prisma),
    readTargetMarginPct(prisma),
  ]);

  const now = new Date();
  const rows = await loadUnitsWithMargins(prisma, {}, { vat, now });

  // Map Prisma rows into finance.ts's plain-data input once, here — that module
  // stays free of any Prisma import so it can be tested without a connection.
  const units: SoldUnit[] = rows.map((r) => ({
    unitId: r.unit.id,
    sku: r.unit.sku,
    soldAt: r.unit.soldAt,
    soldOn: r.unit.soldOn,
    margin: r.margin,
  }));

  const start = periodStart(period, now);
  const sold = inPeriod(units, start);

  const kpis = financeKpis(sold);
  const pnl = monthlyPnl(units, { start, now });
  const costs = costBreakdown(sold);
  const channels = byMarketplace(sold);
  const { best, worst } = extremes(sold, 5);
  const position = cashPosition(units);

  const marketplaceLabel = (key: string) =>
    key === ""
      ? "Vente directe"
      : (marketplaces.find((m) => m.key === key)?.label ?? key);

  const periodHref = (key: FinancePeriod) => `/chronos/finance?periode=${key}`;

  const belowTarget = kpis.marginPct !== null && kpis.marginPct < targetMarginPct;

  return (
    <div>
      <PageHeader
        title="Finances"
        subtitle="Résultat réalisé, coûts et capital immobilisé — calculés sur le registre des coûts."
      >
        <nav
          aria-label="Période"
          className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
        >
          {FINANCE_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={periodHref(p.key)}
              aria-current={p.key === period ? "page" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                p.key === period
                  ? "bg-realm-subtle text-realm"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </PageHeader>

      <div className="space-y-6 p-6">
        {/* Realised P&L for the period. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Kpi
            value={formatCents(kpis.revenueCents)}
            label="Chiffre d'affaires"
            hint={`${kpis.soldCount} vente${kpis.soldCount > 1 ? "s" : ""}`}
          />
          <Kpi
            value={formatCents(kpis.cogsCents)}
            label="Coût de revient"
            hint="achat + restauration + frais"
          />
          <Kpi
            value={formatCents(kpis.vatCents)}
            label="TVA due"
            hint={vatSchemeLabel(vat.vatScheme)}
          />
          <Kpi
            value={formatCents(kpis.netMarginCents)}
            label="Marge nette"
            hint={`${formatPct(kpis.marginPct)} · objectif ${targetMarginPct} %`}
            tone={
              kpis.netMarginCents < 0 ? "danger" : belowTarget ? "warning" : "success"
            }
          />
          <Kpi
            value={formatCents(position.cashTiedUpCents)}
            label="Capital immobilisé"
            hint={`${position.inStockCount} en stock · hors période`}
            tone={position.staleCashCents > 0 ? "warning" : undefined}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Résultat mensuel</CardTitle>
          </CardHeader>
          <CardBody>
            {pnl.length === 0 ? (
              <EmptyState
                title="Aucune vente sur la période"
                hint="Importez des ventes ou élargissez la période pour voir le résultat."
              />
            ) : (
              <PnlChart
                data={pnl.map((p) => ({
                  name: p.label,
                  revenue: p.revenueCents / 100,
                  cost: p.costCents / 100,
                  net: p.netMarginCents / 100,
                }))}
              />
            )}
          </CardBody>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Répartition des coûts</CardTitle>
            </CardHeader>
            <CardBody>
              {kpis.cogsCents === 0 ? (
                <EmptyState
                  title="Aucun coût sur la période"
                  hint="Les coûts apparaissent ici dès qu'une unité est vendue."
                />
              ) : (
                <Donut
                  data={COST_GROUP_ORDER.filter((g) => costs[g] > 0).map((g, i) => ({
                    name: COST_GROUP_LABELS[g],
                    value: costs[g] / 100,
                    // Indexes into the sanctioned series order rather than
                    // picking a hue (docs/chronos/BRAND.md §2.4).
                    color: `var(--chart-${(i % 6) + 1})`,
                  }))}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Capital immobilisé par ancienneté</CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Ancienneté</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Pièces</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {position.ageing.map((row) => (
                    <tr key={row.bucket} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5">
                        {row.bucket === "90+" ? "90 jours et plus" : `${row.bucket} jours`}
                      </td>
                      <td className="px-4 py-2.5 text-right tnum">{row.unitCount}</td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right tnum",
                          row.bucket === "90+" && row.cashTiedUpCents > 0
                            ? "font-medium text-warning"
                            : undefined,
                        )}
                      >
                        {formatCents(row.cashTiedUpCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-3 text-xs text-muted">
                Position actuelle du stock, indépendante de la période choisie.
              </p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Performance par canal</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {channels.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Aucune vente sur la période"
                  hint="Chaque canal apparaît ici dès la première vente rapprochée."
                />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Canal</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Ventes</th>
                    <th className="px-4 py-2.5 text-right font-semibold">CA</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Frais</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Marge nette</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Marge %</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Jours moy.</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.key} className="border-b border-border last:border-0">
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        {marketplaceLabel(c.key)}
                      </td>
                      <td className="px-4 py-2.5 text-right tnum">{c.soldCount}</td>
                      <td className="px-4 py-2.5 text-right tnum">
                        {formatCents(c.revenueCents)}
                      </td>
                      <td className="px-4 py-2.5 text-right tnum text-muted">
                        {formatCents(c.feesCents)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right tnum font-medium",
                          c.netMarginCents < 0 ? "text-danger" : "text-foreground",
                        )}
                      >
                        {formatCents(c.netMarginCents)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right tnum",
                          c.marginPct !== null && c.marginPct < targetMarginPct
                            ? "text-warning"
                            : "text-muted",
                        )}
                      >
                        {formatPct(c.marginPct)}
                      </td>
                      <td className="px-4 py-2.5 text-right tnum text-muted">
                        {c.avgDaysHeld ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <UnitBoard title="Meilleures ventes" lines={best} />
          <UnitBoard title="Ventes les moins rentables" lines={worst} />
        </div>

        <p className="flex items-start gap-2 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
          <span>
            Chiffres calculés sur le registre des coûts, sous le régime «{" "}
            {vatSchemeLabel(vat.vatScheme)} » à {vat.vatRatePct} %. Ces montants
            ne constituent pas un conseil fiscal — faites valider le régime
            applicable par votre comptable avant toute déclaration.
          </span>
        </p>
      </div>
    </div>
  );
}

function Kpi({
  value,
  label,
  hint,
  tone,
}: {
  value: string;
  label: string;
  hint: string;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <Card>
      <CardBody>
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight tnum",
            tone === "danger" && "text-danger",
            tone === "warning" && "text-warning",
            tone === "success" && "text-success",
          )}
        >
          {value}
        </p>
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-1 text-xs text-faint tnum">{hint}</p>
      </CardBody>
    </Card>
  );
}

function UnitBoard({
  title,
  lines,
}: {
  title: string;
  lines: {
    unitId: string;
    sku: string;
    netMarginCents: number;
    marginPct: number | null;
    daysHeld: number | null;
  }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {lines.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Pas encore assez de ventes"
              hint="Ce classement apparaît dès que la période compte plusieurs ventes."
            />
          </div>
        ) : (
          <ul>
            {lines.map((l) => (
              <li key={l.unitId} className="border-b border-border last:border-0">
                <Link
                  href={`/chronos/${l.unitId}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {l.sku}
                  </span>
                  <span className="shrink-0 text-xs text-faint tnum">
                    {l.daysHeld == null ? "—" : `${l.daysHeld} j`}
                  </span>
                  <span className="shrink-0 text-xs text-muted tnum">
                    {formatPct(l.marginPct)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-medium tnum",
                      l.netMarginCents < 0 ? "text-danger" : "text-success",
                    )}
                  >
                    {formatCents(l.netMarginCents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

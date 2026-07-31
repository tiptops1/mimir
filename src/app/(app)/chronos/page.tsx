import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { getTenantProfile } from "@/lib/tenant-profile";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, LinkButton } from "@/components/ui";
import { UnitFilters } from "@/components/chronos/unit-filters";
import { UnitsTable } from "@/components/chronos/units-table";
import { NewUnitForm } from "@/components/chronos/new-unit-form";
import { getUnitStageDefs } from "@/lib/chronos/unit-stage-config";
import { loadUnitsWithMargins, loadVatConfig } from "@/lib/chronos/inventory";
import { buildUnitWhere, filterUnitRows, sortUnitRows } from "@/lib/chronos/list";
import { summarizeMargins } from "@/lib/chronos/margin";
import { readMarketplaces, readTargetMarginPct } from "@/lib/chronos/config";
import { formatCents, formatPct } from "@/lib/display";
import { str } from "@/lib/list-filters";

/**
 * Chronos inventory — cockpit KPIs over the filtered list.
 *
 * Deliberately NOT the companies pages' <Suspense> + separate async table
 * split. That pattern counts in the page and slices in the table, which works
 * only because both halves share one Prisma where-clause. Margin here is
 * derived from the cost ledger, so filtering and counting happen in memory
 * after the load — splitting would mean loading twice. See chronos/list.ts.
 */

const PAGE_SIZE = 25;

export default async function ChronosPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();
  const profile = await getTenantProfile();
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(str(sp, "page"), 10) || 1);

  const [stages, vat, marketplaces, targetMarginPct] = await Promise.all([
    getUnitStageDefs(),
    loadVatConfig(prisma),
    readMarketplaces(prisma),
    readTargetMarginPct(prisma),
  ]);

  const all = await loadUnitsWithMargins(prisma, buildUnitWhere(sp), { vat });
  const rows = sortUnitRows(
    filterUnitRows(all, sp, targetMarginPct),
    str(sp, "tri"),
  );

  // The cockpit summarises what's on screen, not the whole collection — the
  // filters are the question the operator is asking.
  const summary = summarizeMargins(rows.map((r) => r.margin));
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const qs = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === "string" && v && k !== "page") params.set(k, v);
    }
    for (const [k, v] of Object.entries(overrides)) params.set(k, String(v));
    return `?${params.toString()}`;
  };

  const ageing = Object.fromEntries(
    summary.ageing.map((a) => [a.bucket, a]),
  );

  return (
    <div>
      <PageHeader
        title="Inventaire"
        subtitle={`Achat, restauration et revente — ${profile.brandName}`}
      >
        <LinkButton href="/chronos/import" variant="secondary" size="sm">
          Importer des ventes
        </LinkButton>
        <LinkButton href="/chronos/settings" variant="ghost" size="sm">
          Paramètres
        </LinkButton>
      </PageHeader>
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">
                {summary.inStockCount}
              </p>
              <p className="text-xs text-muted">En stock</p>
              <p className="mt-1 text-xs text-faint tnum">
                {summary.soldCount} vendues
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">
                {formatCents(summary.cashTiedUpCents)}
              </p>
              <p className="text-xs text-muted">Capital immobilisé</p>
              <p className="mt-1 text-xs text-faint tnum">
                {ageing["90+"]?.unitCount ?? 0} pièce
                {(ageing["90+"]?.unitCount ?? 0) > 1 ? "s" : ""} &gt; 90 j
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p
                className={`text-2xl font-semibold tracking-tight tnum ${
                  summary.netMarginCents < 0 ? "text-danger" : "text-success"
                }`}
              >
                {formatCents(summary.netMarginCents)}
              </p>
              <p className="text-xs text-muted">Marge nette réalisée</p>
              <p className="mt-1 text-xs text-faint tnum">
                sur {formatCents(summary.revenueCents)}
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p
                className={`text-2xl font-semibold tracking-tight tnum ${
                  summary.marginPct !== null && summary.marginPct < targetMarginPct
                    ? "text-warning"
                    : "text-foreground"
                }`}
              >
                {formatPct(summary.marginPct)}
              </p>
              <p className="text-xs text-muted">Marge %</p>
              <p className="mt-1 text-xs text-faint tnum">
                objectif {targetMarginPct} %
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">
                {summary.avgMarginPerDayCents === null
                  ? "—"
                  : formatCents(summary.avgMarginPerDayCents)}
              </p>
              <p className="text-xs text-muted">Marge / jour de capital</p>
              <p className="mt-1 text-xs text-faint">moyenne sur les ventes</p>
            </CardBody>
          </Card>
        </div>

        <NewUnitForm />

        <div>
          <UnitFilters stages={stages} marketplaces={marketplaces} />
          <UnitsTable rows={pageRows} stages={stages} />

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted">
                Page {safePage} sur {totalPages} · {rows.length} pièces
              </span>
              <div className="flex gap-2">
                {safePage > 1 && (
                  <Link
                    href={qs({ page: safePage - 1 })}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium transition-colors hover:bg-surface-2 hover:border-border-strong"
                  >
                    Précédent
                  </Link>
                )}
                {safePage < totalPages && (
                  <Link
                    href={qs({ page: safePage + 1 })}
                    className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium transition-colors hover:bg-surface-2 hover:border-border-strong"
                  >
                    Suivant
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

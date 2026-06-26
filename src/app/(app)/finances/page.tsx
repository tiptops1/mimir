import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle, Badge } from "@/components/ui";
import { Donut } from "@/components/charts";
import { FinanceTable } from "@/components/finance-table";
import { FinanceKpiStrip } from "@/components/finance-kpi-strip";
import { computeFinanceCockpit } from "@/lib/finance-cockpit";
import { getNumberSetting, SETTINGS } from "@/lib/settings";
import { DEFAULT_FINANCE_CATEGORIES } from "@/lib/finance";
import { formatCurrency, companyName } from "@/lib/display";
import { formatDate } from "@/lib/utils";

const CAT_COLORS = [
  "#4f46e5",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#ec4899",
  "#64748b",
];

export default async function FinancesPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const [cockpit, cash, catDef, companiesRaw] = await Promise.all([
    computeFinanceCockpit(prisma),
    getNumberSetting(prisma, SETTINGS.cashOnHand),
    prisma.fieldDefinition.findFirst({
      where: { entity: "FINANCE", key: "category" },
      select: { options: true },
    }),
    prisma.company.findMany({
      select: { id: true, nomSociete: true, enseigne: true, siret: true },
      orderBy: { nomSociete: "asc" },
    }),
  ]);

  const categories =
    catDef?.options && catDef.options.length > 0
      ? catDef.options
      : DEFAULT_FINANCE_CATEGORIES;
  const companies = companiesRaw.map((c) => ({
    id: c.id,
    name: companyName(c),
  }));

  const donutData = cockpit.byCategory.map((c, i) => ({
    name: c.name,
    value: c.value,
    color: CAT_COLORS[i % CAT_COLORS.length],
  }));

  return (
    <div>
      <PageHeader
        title="Finances"
        subtitle="Pilotez votre activité — coûts, abonnements, factures et rentabilité"
      />

      <div className="space-y-6 p-6">
        {/* Cockpit KPI strip — the numbers an owner pilots by. */}
        <FinanceKpiStrip cockpit={cockpit} cash={cash} />

        {/* Forward strip: what's about to cost or pay, + cost mix. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Échéances · 30 jours</CardTitle>
              {cockpit.radar.length > 0 && (
                <Badge className="bg-amber-100 text-amber-700">
                  {cockpit.radar.length} à traiter
                </Badge>
              )}
            </CardHeader>
            <CardBody className="space-y-2">
              {cockpit.radar.length === 0 ? (
                <p className="text-sm text-muted">
                  Aucune échéance dans les 30 prochains jours.
                </p>
              ) : (
                cockpit.radar.map((r) => (
                  <Link
                    key={`${r.id}-${r.type}`}
                    href={`/finances/${r.id}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
                  >
                    <Badge className={r.badge}>{r.type}</Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-muted">
                        {r.days < 0
                          ? `en retard de ${-r.days} j`
                          : r.days === 0
                            ? "aujourd'hui"
                            : `dans ${r.days} j`}{" "}
                        · {formatDate(r.dateIso)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium">
                      {formatCurrency(r.amount)}
                    </span>
                  </Link>
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Coûts par catégorie</CardTitle>
            </CardHeader>
            <CardBody>
              {donutData.length === 0 ? (
                <p className="text-sm text-muted">
                  Ajoutez des coûts pour voir leur répartition.
                </p>
              ) : (
                <Donut data={donutData} />
              )}
            </CardBody>
          </Card>
        </div>

        <FinanceTable
          entries={cockpit.rows}
          categories={categories}
          companies={companies}
        />
      </div>
    </div>
  );
}

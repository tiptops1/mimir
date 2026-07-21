import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardBody, Badge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { aggregateInsights, deriveRates, lastNDays } from "@/lib/freyja/metrics";
import { FREYJA_MODULE } from "@/lib/freyja/decide";

// Freyja (S25) — paid-marketing dashboard: unified campaign metrics through
// the tenant's configured connector, live-derived from CampaignInsight rows
// on every load (Thor posture — a missed cron never desyncs the UI beyond
// staleness). Read-only; decisions surface in the Heimdallr inbox.

function euros(n: number): string {
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
}

export default async function FreyjaPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const days14 = lastNDays(14);
  const [campaigns, config, pendingCount, lastSync] = await Promise.all([
    prisma.campaign.findMany({
      orderBy: { dailyBudget: "desc" },
      include: {
        insights: {
          where: { day: { gte: days14[0] } },
          select: {
            day: true,
            spendEur: true,
            impressions: true,
            clicks: true,
            conversions: true,
            conversionValue: true,
          },
        },
      },
    }),
    prisma.freyjaConfig.findUnique({ where: { singleton: "default" } }),
    prisma.agentAction.count({ where: { module: FREYJA_MODULE, status: "PROPOSED" } }),
    prisma.agentEvent.findFirst({
      where: { module: FREYJA_MODULE, category: "sync", action: "completed" },
      orderBy: { at: "desc" },
      select: { at: true, data: true },
    }),
  ]);

  const roasFloor = config?.roasFloor ?? 1.5;
  const rows = campaigns.map((c) => {
    const agg = aggregateInsights(c.insights);
    return { campaign: c, agg, rates7: c.insights.length ? agg.last7.rates : deriveRates(agg.totals) };
  });

  const active = rows.filter((r) => r.campaign.status === "ACTIVE");
  const spend7 = rows.reduce((sum, r) => sum + r.agg.last7.spendEur, 0);
  const conversions7 = rows.reduce((sum, r) => sum + r.agg.last7.conversions, 0);
  const value7 = rows.reduce((sum, r) => sum + r.agg.last7.conversionValue, 0);
  const roas7 = spend7 > 0 ? value7 / spend7 : null;

  const roasTone = (roas: number | null): "success" | "warning" | "danger" | "neutral" => {
    if (roas === null) return "neutral";
    if (roas >= roasFloor * 2) return "success";
    if (roas >= roasFloor) return "warning";
    return "danger";
  };

  return (
    <div>
      <PageHeader title="Freyja" subtitle="Marketing payant — campagnes et décisions" />
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">{active.length}</p>
              <p className="text-xs text-muted">Campagnes actives</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">{euros(spend7)}</p>
              <p className="text-xs text-muted">Dépense (7 j)</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">{conversions7}</p>
              <p className="text-xs text-muted">Conversions (7 j)</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p
                className={`text-2xl font-semibold tracking-tight tnum ${
                  roas7 === null
                    ? ""
                    : roas7 >= roasFloor
                      ? "text-success"
                      : "text-danger"
                }`}
              >
                {roas7 === null ? "—" : roas7.toFixed(2)}
              </p>
              <p className="text-xs text-muted">ROAS moyen (7 j)</p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Campagnes</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {campaigns.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Aucune campagne"
                  hint="Connectez une plateforme publicitaire ou lancez le seed de démonstration (scripts/freyja/seed-demo-campaigns.ts)."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 font-semibold">Campagne</th>
                      <th className="px-4 py-2.5 font-semibold">Canal</th>
                      <th className="px-4 py-2.5 font-semibold">Budget jour</th>
                      <th className="px-4 py-2.5 font-semibold">Dépense 7 j</th>
                      <th className="px-4 py-2.5 font-semibold">CPA 7 j</th>
                      <th className="px-4 py-2.5 font-semibold">ROAS 7 j</th>
                      <th className="px-4 py-2.5 font-semibold">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ campaign, agg }) => {
                      const rates = agg.last7.rates;
                      return (
                        <tr key={campaign.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-2.5 font-medium">{campaign.name}</td>
                          <td className="px-4 py-2.5 text-muted">{campaign.channel}</td>
                          <td className="px-4 py-2.5 tnum">{euros(campaign.dailyBudget)}</td>
                          <td className="px-4 py-2.5 tnum">{euros(agg.last7.spendEur)}</td>
                          <td className="px-4 py-2.5 tnum">
                            {rates.cpa === null ? "—" : euros(rates.cpa)}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge tone={roasTone(rates.roas)}>
                              {rates.roas === null ? "—" : rates.roas.toFixed(2)}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge tone={campaign.status === "ACTIVE" ? "success" : "neutral"}>
                              {campaign.status === "ACTIVE" ? "Active" : "En pause"}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Propositions en attente</CardTitle>
            </CardHeader>
            <CardBody>
              {pendingCount > 0 ? (
                <Link href="/heimdallr/inbox?module=freyja" className="text-sm hover:underline">
                  <span className="tnum font-semibold">{pendingCount}</span> décision
                  {pendingCount > 1 ? "s" : ""} de campagne en attente d&apos;approbation →
                </Link>
              ) : (
                <p className="text-sm text-muted">
                  Aucune décision de campagne en attente. L&apos;agent propose ses décisions dans
                  la boîte Heimdallr.
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Dernière synchronisation</CardTitle>
            </CardHeader>
            <CardBody>
              {lastSync ? (
                <p className="text-sm">
                  {formatDate(lastSync.at)}
                  <span className="text-muted">
                    {" "}
                    — {(lastSync.data as { rowsUpserted?: number })?.rowsUpserted ?? "?"} lignes de
                    métriques
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted">Aucune synchronisation n&apos;a encore eu lieu.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

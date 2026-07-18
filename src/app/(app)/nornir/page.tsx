import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardBody, Badge, EmptyState } from "@/components/ui";
import { getStageDefs } from "@/lib/stage-config";
import { formatCurrency } from "@/lib/display";
import { formatDate } from "@/lib/utils";

const usd = (n: number) => `$${n.toFixed(4)}`;
import {
  getPilotStats,
  listRecentAgentEvents,
  getTokenUsageSnapshot,
} from "@/lib/nornir/queries";

// Nornir (S17) — the pilot dashboard: "the whole company at a glance" +
// agent-activity feed + token-usage UI. Read-only reporting surface, same
// posture as S13's Mímisbrunnr demo page: no server action, no ledger write.

const MODULE_LABEL: Record<string, string> = {
  heimdallr: "Heimdallr",
  mimisbrunnr: "Mímisbrunnr",
  huginn: "Huginn",
  muninn: "Muninn",
  nornir: "Nornir",
  bragi: "Bragi",
  forseti: "Forseti",
  system: "Système",
};

const MODULE_TONE = {
  heimdallr: "brand",
  mimisbrunnr: "info",
  huginn: "success",
  muninn: "warning",
  nornir: "info",
  bragi: "success",
  forseti: "warning",
  system: "neutral",
} as const;

export default async function NornirPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const [pilot, events, usage, stageDefs] = await Promise.all([
    getPilotStats(prisma),
    listRecentAgentEvents(prisma, { limit: 20 }),
    getTokenUsageSnapshot(prisma),
    getStageDefs(),
  ]);

  const stageCount = (stage: string) =>
    pilot.stageCounts.find((s) => s.stage === stage)?.count ?? 0;
  const maxStage = Math.max(1, ...stageDefs.map((s) => stageCount(s.value)));

  const budgetPct = usage.limitUsd > 0
    ? Math.min(100, Math.round((usage.spentUsd / usage.limitUsd) * 100))
    : 0;

  return (
    <div>
      <PageHeader
        title="Nornir"
        subtitle="Le pouls de l'activité — vue d'ensemble, agents, consommation IA"
      />
      <div className="space-y-6 p-6">
        {/* Pulse — the whole company at a glance */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">{pilot.companyCount}</p>
              <p className="text-xs text-muted">Sociétés</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">{pilot.contactCount}</p>
              <p className="text-xs text-muted">Contacts</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">
                {formatCurrency(pilot.openPipeline)}
              </p>
              <p className="text-xs text-muted">Pipeline ouvert</p>
            </CardBody>
          </Card>
          <Card>
            <Link href="/heimdallr/inbox">
              <CardBody>
                <p className="text-2xl font-semibold tracking-tight tnum">
                  {pilot.pendingApprovals}
                </p>
                <p className="text-xs text-muted">Approbations en attente</p>
              </CardBody>
            </Link>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Répartition du pipeline</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5">
              {stageDefs.map((s) => {
                const count = stageCount(s.value);
                return (
                  <Link
                    key={s.value}
                    href={`/pipeline?stage=${s.value}`}
                    className="flex items-center gap-3 rounded-md px-1 py-0.5 hover:bg-surface-2"
                  >
                    <span className="w-40 shrink-0 text-sm text-muted">{s.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={`h-full rounded-full ${s.dot}`}
                        style={{ width: `${(count / maxStage) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-medium tnum">{count}</span>
                  </Link>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Net ce mois</CardTitle>
            </CardHeader>
            <CardBody>
              <p
                className={`text-2xl font-semibold tracking-tight ${
                  pilot.netThisMonth >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}
              >
                {pilot.netThisMonth >= 0 ? "+" : ""}
                {formatCurrency(pilot.netThisMonth)}
              </p>
              <Link href="/finances" className="mt-2 inline-block text-xs font-medium text-brand hover:underline">
                Ouvrir les finances
              </Link>
            </CardBody>
          </Card>
        </div>

        {/* Agent-activity feed */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Activité des agents</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {events.length === 0 ? (
                <EmptyState
                  title="Aucun événement pour l'instant"
                  hint="Les agents publieront ici dès leur première action."
                />
              ) : (
                events.map((e) => {
                  const row = (
                    <div className="flex items-start gap-3 text-sm">
                      <Badge
                        tone={MODULE_TONE[e.module as keyof typeof MODULE_TONE] ?? "neutral"}
                        className="mt-0.5 shrink-0"
                      >
                        {MODULE_LABEL[e.module] ?? e.module}
                      </Badge>
                      <div className="min-w-0">
                        <p className="truncate">
                          <span className="font-medium">{e.category}</span>
                          {" · "}
                          <span className="text-muted">{e.action}</span>
                        </p>
                        <p className="text-xs text-muted">{formatDate(e.at)}</p>
                      </div>
                    </div>
                  );
                  return e.actionId ? (
                    <Link
                      key={e.id}
                      href={`/heimdallr/inbox?module=${e.module}`}
                      className="-mx-1 block rounded-md px-1 py-0.5 hover:bg-surface-2"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div key={e.id}>{row}</div>
                  );
                })
              )}
            </CardBody>
          </Card>

          {/* Token-usage UI */}
          <Card>
            <CardHeader>
              <CardTitle>Consommation IA</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Ce mois</span>
                  <span className={`font-medium tnum ${usage.overBudget ? "text-rose-700" : ""}`}>
                    {usd(usage.spentUsd)} / {usd(usage.limitUsd)}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${usage.overBudget ? "bg-danger" : "bg-brand"}`}
                    style={{ width: `${budgetPct}%` }}
                  />
                </div>
              </div>

              {usage.byTaskClass.length === 0 ? (
                <p className="text-sm text-muted">Aucun appel IA ce mois-ci.</p>
              ) : (
                <div className="space-y-1.5">
                  {usage.byTaskClass.map((t) => (
                    <div key={t.taskClass} className="flex items-center justify-between text-sm">
                      <span className="text-muted">{t.taskClass}</span>
                      <span className="tnum">
                        {usd(t.costUsd)} · {t.calls} appels
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

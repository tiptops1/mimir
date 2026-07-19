import Link from "next/link";
import { Building2, Users, Trophy, Flame } from "lucide-react";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { StageBadge } from "@/components/badges";
import { ConnectGmailCta } from "@/components/connect-gmail-cta";
import { OutreachPausedBanner } from "@/components/outreach/paused-banner";
import { TaskList, type TaskRow } from "@/components/task-list";
import { FinanceKpiStrip } from "@/components/finance-kpi-strip";
import { Observatory, type ObservatoryRealm } from "@/components/observatory";
import { companyName } from "@/lib/display";
import { formatDate } from "@/lib/utils";
import { ACTIVITY_TYPES } from "@/lib/constants";
import { getStageDefs } from "@/lib/stage-config";
import { getGoogleConnection } from "@/lib/integrations";
import { computeFinanceCockpit } from "@/lib/finance-cockpit";
import { getNumberSetting, SETTINGS } from "@/lib/settings";
import { countPendingActions } from "@/lib/heimdallr/queries";
import { checkBudget } from "@/lib/ai/meter";

const eur = (n: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);

const activityLabel = (t: string) =>
  ACTIVITY_TYPES.find((a) => a.value === t)?.label ?? t;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const stageDefs = await getStageDefs();
  const googleStatus = (await searchParams).google;

  // Forward-looking windows for the worklist strip.
  const startOfTomorrow = new Date();
  startOfTomorrow.setHours(0, 0, 0, 0);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const staleBefore = new Date();
  staleBefore.setDate(staleBefore.getDate() - 30);

  const [
    total,
    contactsCount,
    companies,
    recentCompanies,
    recentActivities,
    googleConn,
    todayTasksRaw,
    staleCompanies,
    leadsSourced,
    leadsValidated,
  ] =
    await Promise.all([
      prisma.company.count(),
      prisma.contact.count(),
      prisma.company.findMany({ select: { stage: true } }),
      prisma.company.findMany({
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: {
          id: true,
          nomSociete: true,
          enseigne: true,
          siret: true,
          ville: true,
          stage: true,
        },
      }),
      prisma.activity.findMany({
        orderBy: { date: "desc" },
        take: 8,
        include: {
          company: { select: { id: true, nomSociete: true, enseigne: true, siret: true } },
        },
      }),
      getGoogleConnection(session.tenantId),
      // Open tasks that need attention now (overdue or due today).
      prisma.task.findMany({
        where: { done: false, dueDate: { not: null, lt: startOfTomorrow } },
        orderBy: { dueDate: "asc" },
        take: 8,
        include: {
          company: { select: { id: true, nomSociete: true, enseigne: true, siret: true } },
        },
      }),
      // Engaged prospects gone cold: last touch > 30 days, not yet won/lost.
      prisma.company.findMany({
        where: {
          dernierContact: { not: null, lt: staleBefore },
          stage: { notIn: ["GAGNE", "PERDU"] },
        },
        orderBy: { dernierContact: "asc" },
        take: 6,
        select: {
          id: true,
          nomSociete: true,
          enseigne: true,
          siret: true,
          stage: true,
          dernierContact: true,
        },
      }),
      prisma.leadCandidate.count(),
      prisma.leadCandidate.count({ where: { status: "VALIDATED" } }),
    ]);

  const [financeCockpit, financeCash, outreachConfig, pendingApprovals, aiBudget] =
    await Promise.all([
      computeFinanceCockpit(prisma),
      getNumberSetting(prisma, SETTINGS.cashOnHand),
      // findFirst, not the creating getter: the banner must not seed config rows.
      prisma.outreachConfig.findFirst(),
      countPendingActions(prisma),
      checkBudget(prisma),
    ]);

  const todayTasks: TaskRow[] = todayTasksRaw.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    source: t.source,
    company: t.company
      ? { id: t.company.id, name: companyName(t.company) }
      : null,
  }));

  const stageCounts = new Map<string, number>();
  for (const c of companies)
    stageCounts.set(c.stage, (stageCounts.get(c.stage) ?? 0) + 1);
  const gagne = stageCounts.get("GAGNE") ?? 0;
  const aContacter = stageCounts.get("A_CONTACTER") ?? 0;

  const firstName = session.name?.split(" ")[0] || "";

  const observatoryRealms: ObservatoryRealm[] = [
    {
      slug: "relation",
      label: "Relation",
      role: "Suivi commercial — sociétés, contacts, pipeline",
      status: "live",
      stats: [
        { value: String(total), label: "sociétés suivies" },
        { value: String(contactsCount), label: "contacts" },
      ],
      href: "/companies",
    },
    {
      slug: "chasse",
      label: "Chasse",
      role: "Génération de leads — courtiers et intermédiaires",
      status: "live",
      stats: [
        { value: String(leadsSourced), label: "leads sourcés" },
        { value: String(leadsValidated), label: "validés" },
      ],
      href: "/leadone",
    },
    {
      slug: "tresor",
      label: "Trésor",
      role: "Coûts, abonnements, rentabilité",
      status: "live",
      stats: [
        { value: eur(financeCockpit.net), label: "net ce mois" },
        { value: eur(financeCockpit.openPipeline), label: "pipeline ouvert" },
      ],
      href: "/finances",
    },
    {
      slug: "mimir",
      label: "Mimir",
      role: "Agents autonomes — approbations, connaissance, activité",
      status: "live",
      stats: [
        { value: String(pendingApprovals), label: "à approuver" },
        { value: `$${aiBudget.used.toFixed(2)}`, label: "IA ce mois" },
      ],
      href: "/nornir",
    },
  ];

  const kpis = [
    { label: "Sociétés", value: total, icon: Building2, color: "text-indigo-600", tile: "bg-brand-subtle", href: "/companies" },
    { label: "Contacts", value: contactsCount, icon: Users, color: "text-sky-600", tile: "bg-sky-50", href: "/contacts" },
    { label: "À contacter", value: aContacter, icon: Flame, color: "text-orange-600", tile: "bg-orange-50", href: "/companies?stage=A_CONTACTER" },
    { label: "Gagnés", value: gagne, icon: Trophy, color: "text-emerald-600", tile: "bg-emerald-50", href: "/companies?stage=GAGNE" },
  ];

  const maxStage = Math.max(1, ...stageDefs.map((s) => stageCounts.get(s.value) ?? 0));

  return (
    <div>
      <div className="p-4 sm:p-6">
        <Observatory
          realms={observatoryRealms}
          hub={{
            label: "Mimir",
            caption: firstName ? `Bonjour, ${firstName}` : "Bonjour",
            stat: `${total} sociétés · ${observatoryRealms.filter((r) => r.status === "live").length} royaumes actifs`,
          }}
          tenantLabel={session.name || session.email}
        />
      </div>

      <div className="space-y-6 p-6">
        {outreachConfig?.paused && (
          <OutreachPausedBanner
            reason={outreachConfig.pausedReason}
            pausedAt={
              outreachConfig.pausedAt ? formatDate(outreachConfig.pausedAt) : null
            }
            canResume={session.role === "ADMIN"}
          />
        )}
        {googleStatus === "connected" && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
            Compte Google connecté. La synchronisation démarre au prochain cycle.
          </div>
        )}
        {googleStatus === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
            La connexion Google a échoué. Réessayez de connecter votre compte.
          </div>
        )}
        <ConnectGmailCta
          connected={Boolean(googleConn)}
          accountEmail={googleConn?.accountEmail ?? null}
          lastSyncLabel={
            googleConn?.lastSyncedAt ? formatDate(googleConn.lastSyncedAt) : null
          }
        />

        {/* Forward-looking worklist — what to act on today, before the reporting. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex items-center justify-between">
              <CardTitle>À faire aujourd'hui</CardTitle>
              <Link href="/todo" className="text-xs font-medium text-brand hover:underline">
                Tout voir
              </Link>
            </CardHeader>
            <CardBody>
              <TaskList
                tasks={todayTasks}
                empty="Rien d'urgent aujourd'hui. Planifiez une relance depuis une fiche prospect."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prospects à relancer</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {staleCompanies.length === 0 ? (
                <p className="text-sm text-muted">Aucun prospect en sommeil.</p>
              ) : (
                staleCompanies.map((c) => (
                  <Link
                    key={c.id}
                    href={`/companies/${c.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{companyName(c)}</p>
                      <p className="text-xs text-rose-600">
                        Dernier contact {formatDate(c.dernierContact)}
                      </p>
                    </div>
                    <StageBadge stage={c.stage} stageDefs={stageDefs} />
                  </Link>
                ))
              )}
            </CardBody>
          </Card>
        </div>

        {/* Business cockpit — revenue vs costs vs net, with runway. */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Santé de l&apos;activité
            </h2>
            <Link
              href="/finances"
              className="text-xs font-medium text-brand hover:underline"
            >
              Ouvrir les finances
            </Link>
          </div>
          <FinanceKpiStrip cockpit={financeCockpit} cash={financeCash} />
        </section>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <Card
                key={k.label}
                className="transition-[border-color,box-shadow] duration-100 hover:border-border-strong hover:shadow-sm"
              >
                <Link href={k.href}>
                  <CardBody className="flex items-center gap-4">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${k.tile}`}>
                      <Icon className={`h-5 w-5 ${k.color}`} />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold tracking-tight tnum">{k.value}</p>
                      <p className="text-xs text-muted">{k.label}</p>
                    </div>
                  </CardBody>
                </Link>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Répartition du pipeline</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5">
              {stageDefs.map((s) => {
                const count = stageCounts.get(s.value) ?? 0;
                return (
                  <Link
                    key={s.value}
                    href={`/pipeline?stage=${s.value}`}
                    className="flex items-center gap-3 rounded-md px-1 py-0.5 hover:bg-surface-2"
                  >
                    <span className="w-40 shrink-0 text-sm text-muted">
                      {s.label}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={`h-full rounded-full ${s.dot}`}
                        style={{ width: `${(count / maxStage) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-medium tnum">
                      {count}
                    </span>
                  </Link>
                );
              })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activité récente</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {recentActivities.length === 0 ? (
                <p className="text-sm text-muted">Aucune activité récente.</p>
              ) : (
                recentActivities.map((a) => (
                  <div key={a.id} className="flex gap-3 text-sm">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                    <div className="min-w-0">
                      <p className="truncate">
                        <span className="font-medium">
                          {activityLabel(a.type)}
                        </span>
                        {a.company ? (
                          <>
                            {" · "}
                            <Link
                              href={`/companies/${a.company.id}`}
                              className="text-brand hover:underline"
                            >
                              {companyName(a.company)}
                            </Link>
                          </>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted">{formatDate(a.date)}</p>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sociétés récemment modifiées</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {recentCompanies.map((c) => (
              <Link
                key={c.id}
                href={`/companies/${c.id}`}
                className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-surface-2"
              >
                <div>
                  <p className="text-sm font-medium">{companyName(c)}</p>
                  <p className="text-xs text-muted">{c.ville ?? "—"}</p>
                </div>
                <StageBadge stage={c.stage} stageDefs={stageDefs} />
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

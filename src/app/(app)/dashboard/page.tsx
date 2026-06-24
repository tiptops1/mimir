import Link from "next/link";
import { Building2, Users, Trophy, Flame } from "lucide-react";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession } from "@/lib/dal";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle, LinkButton } from "@/components/ui";
import { StageBadge } from "@/components/badges";
import { ConnectGmailCta } from "@/components/connect-gmail-cta";
import { companyName } from "@/lib/display";
import { formatDate } from "@/lib/utils";
import { PIPELINE_STAGES, ACTIVITY_TYPES } from "@/lib/constants";
import { getGoogleConnection } from "@/lib/integrations";

const activityLabel = (t: string) =>
  ACTIVITY_TYPES.find((a) => a.value === t)?.label ?? t;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const googleStatus = (await searchParams).google;

  const [
    total,
    contactsCount,
    companies,
    recentCompanies,
    recentActivities,
    googleConn,
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
    ]);

  const stageCounts = new Map<string, number>();
  for (const c of companies)
    stageCounts.set(c.stage, (stageCounts.get(c.stage) ?? 0) + 1);
  const gagne = stageCounts.get("GAGNE") ?? 0;
  const aContacter = stageCounts.get("A_CONTACTER") ?? 0;

  const firstName = session.name?.split(" ")[0] || "";

  const kpis = [
    { label: "Sociétés", value: total, icon: Building2, color: "text-indigo-500", href: "/companies" },
    { label: "Contacts", value: contactsCount, icon: Users, color: "text-sky-500", href: "/contacts" },
    { label: "À contacter", value: aContacter, icon: Flame, color: "text-orange-500", href: "/companies?stage=A_CONTACTER" },
    { label: "Gagnés", value: gagne, icon: Trophy, color: "text-emerald-500", href: "/companies?stage=GAGNE" },
  ];

  const maxStage = Math.max(1, ...PIPELINE_STAGES.map((s) => stageCounts.get(s.value) ?? 0));

  return (
    <div>
      <PageHeader
        title={`Bonjour${firstName ? `, ${firstName}` : ""} 👋`}
        subtitle="Voici l'état de votre prospection"
      >
        <LinkButton href="/pipeline" variant="secondary">
          Ouvrir le pipeline
        </LinkButton>
        <LinkButton href="/companies/new">+ Société</LinkButton>
      </PageHeader>

      <div className="space-y-6 p-6">
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

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <Card
                key={k.label}
                className="transition-colors hover:border-brand/40 hover:bg-slate-50/60"
              >
                <Link href={k.href}>
                  <CardBody className="flex items-center gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50">
                      <Icon className={`h-5 w-5 ${k.color}`} />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold">{k.value}</p>
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
              {PIPELINE_STAGES.map((s) => {
                const count = stageCounts.get(s.value) ?? 0;
                return (
                  <Link
                    key={s.value}
                    href={`/pipeline?stage=${s.value}`}
                    className="flex items-center gap-3 rounded-md px-1 py-0.5 hover:bg-slate-50"
                  >
                    <span className="w-40 shrink-0 text-sm text-slate-600">
                      {s.label}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${s.dot}`}
                        style={{ width: `${(count / maxStage) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-sm font-medium">
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
                className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium">{companyName(c)}</p>
                  <p className="text-xs text-muted">{c.ville ?? "—"}</p>
                </div>
                <StageBadge stage={c.stage} />
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

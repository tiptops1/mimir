import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { getGoogleConnection } from "@/lib/integrations";
import { PageHeader } from "@/components/page-header";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  LinkButton,
} from "@/components/ui";
import { OutreachPausedBanner } from "@/components/outreach/paused-banner";
import { OutreachConfigForm } from "@/components/outreach/config-form";
import {
  computeOutreachStats,
  recentOutreachMessages,
} from "@/lib/outreach/stats";
import { getOutreachConfig } from "@/lib/outreach/guardrails";
import { formatDate } from "@/lib/utils";

// Cold-email operator surface — the "war machine" dashboard: Chris's 5 metrics,
// the enrollment funnel, recent sends, the config form, plus the current warm-up
// state. Everything drives from the tenant's OutreachConfig singleton.

function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)} %`;
}

function iso(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function OutreachPage() {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const [stats, config, sequences, recent, outreachConn] = await Promise.all([
    computeOutreachStats(prisma),
    getOutreachConfig(prisma),
    prisma.sequence.findMany({
      where: { active: true, mode: "AUTO_EMAIL" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    recentOutreachMessages(prisma, 10),
    getGoogleConnection(session.tenantId, "OUTREACH"),
  ]);

  const bounceOverThreshold =
    stats.bounceRatePct != null && stats.bounceRatePct >= stats.bounceThresholdPct;

  const kpis = [
    {
      label: "Envoyés (7 j)",
      value: stats.sentLast7d.toString(),
      hint: `Aujourd'hui : ${stats.sentToday} / ${stats.dailyCap}`,
    },
    {
      label: "Taux de réponse",
      value: pct(stats.replyRatePct),
      hint: `${stats.funnel.replied} réponses sur ${stats.funnel.total} enrôlements`,
    },
    {
      label: "RDV obtenus",
      value: stats.meetingsBooked.toString(),
      hint: "Sociétés enrôlées avec une réunion",
    },
    {
      label: "Clients gagnés",
      value: stats.won.toString(),
      hint: "Enrôlées ayant atteint une étape « gagné »",
    },
    {
      label: "Taux de bounce (7 j)",
      value: pct(stats.bounceRatePct),
      hint: `Seuil d'alerte : ${stats.bounceThresholdPct} %`,
      danger: bounceOverThreshold,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Outreach"
        subtitle="Le moteur cold email : envois, réponses, désinscriptions"
      >
        <LinkButton href="/outreach/sequences" variant="secondary">
          Séquences
        </LinkButton>
      </PageHeader>

      <div className="space-y-6 p-4 sm:p-6">
        {stats.paused && (
          <OutreachPausedBanner
            reason={stats.pausedReason}
            pausedAt={stats.pausedAt ? formatDate(stats.pausedAt) : null}
            canResume={session.role === "ADMIN"}
          />
        )}

        {!outreachConn && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30">
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Boîte d&apos;envoi cold email non connectée
                </p>
                <p className="text-sm text-muted">
                  Connectez le compte Google du domaine secondaire pour activer
                  les envois automatiques.
                </p>
              </div>
              <LinkButton href="/settings/integrations">
                Ouvrir les intégrations
              </LinkButton>
            </CardBody>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {kpis.map((k) => (
            <Card
              key={k.label}
              className={
                k.danger ? "border-red-300 bg-red-50 dark:bg-red-950/30" : ""
              }
            >
              <CardBody>
                <p className="text-xs text-muted">{k.label}</p>
                <p
                  className={`mt-1 text-2xl font-semibold tnum ${
                    k.danger ? "text-red-700 dark:text-red-300" : "text-foreground"
                  }`}
                >
                  {k.value}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">{k.hint}</p>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Entonnoir</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <FunnelRow label="Enrôlements (total)" value={stats.funnel.total} />
              <FunnelRow label="Actives" value={stats.funnel.active} tone="success" />
              <FunnelRow label="A répondu" value={stats.funnel.replied} tone="info" />
              <FunnelRow label="Terminées sans réponse" value={stats.funnel.done} />
              <FunnelRow label="Email invalide" value={stats.funnel.bounced} tone="danger" />
              <FunnelRow label="Désinscrites" value={stats.funnel.optedOut} tone="danger" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Derniers envois</CardTitle>
            </CardHeader>
            <CardBody>
              {recent.length === 0 ? (
                <EmptyState
                  title="Aucun envoi encore"
                  hint="Les emails apparaîtront ici dès le premier envoi automatique."
                />
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {recent.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <Link
                          href={`/companies/${r.companyId}`}
                          className="truncate font-medium text-foreground hover:text-brand"
                        >
                          {r.companyLabel}
                        </Link>
                        <p className="truncate text-xs text-muted">
                          {r.toEmail} · {r.sequenceName} · étape {r.stepIndex + 1}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge tone={r.status === "BOUNCED" ? "danger" : "neutral"}>
                          {r.status === "BOUNCED" ? "Bounce" : "Envoyé"}
                        </Badge>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {formatDate(r.sentAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Paramètres du moteur</CardTitle>
          </CardHeader>
          <CardBody>
            <OutreachConfigForm
              initial={{
                dailyCap: config.dailyCap,
                rampStartDate: iso(config.rampStartDate),
                rampStartCap: config.rampStartCap,
                rampWeeklyIncrement: config.rampWeeklyIncrement,
                sendWindowStart: config.sendWindowStart,
                sendWindowEnd: config.sendWindowEnd,
                skipHolidays: config.skipHolidays,
                bounceThresholdPct: config.bounceThresholdPct,
                autoEnrollSequenceId: config.autoEnrollSequenceId ?? "",
                unsubscribeText: config.unsubscribeText,
              }}
              sequences={sequences}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function FunnelRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "info" | "danger";
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-foreground">{label}</span>
      <Badge tone={tone ?? "neutral"}>{value}</Badge>
    </div>
  );
}

import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardBody, Badge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import {
  evaluateCompanyHealth,
  summarizeHealth,
  type HealthBand,
  type CompanyHealthInput,
} from "@/lib/thor/health";

// Thor (S22a) — account-health dashboard: live score (recomputed from CRM
// data on every load, so a missed cron never desyncs the UI) plus the last
// scheduled snapshot for "last checked" + a short trend. Same read-only
// posture as Forseti (src/app/(app)/forseti/page.tsx). S22b adds the renewal
// agent + a "Propositions en attente" card once Thor writes to the ledger.

const BAND_TONE: Record<HealthBand, "danger" | "warning" | "success"> = {
  critical: "danger",
  at_risk: "warning",
  healthy: "success",
};

const BAND_LABEL: Record<HealthBand, string> = {
  critical: "Critique",
  at_risk: "À risque",
  healthy: "Sain",
};

export default async function ThorPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const [companies, snapshots] = await Promise.all([
    prisma.company.findMany({
      select: {
        id: true,
        nomSociete: true,
        enseigne: true,
        siret: true,
        dernierContact: true,
        deals: {
          select: { status: true, isPrimary: true, closeDate: true, updatedAt: true },
        },
        activities: {
          orderBy: { date: "desc" },
          take: 1,
          select: { sentiment: true, date: true },
        },
      },
    }),
    prisma.healthSnapshot.findMany({
      orderBy: { takenAt: "desc" },
      take: 5,
      select: {
        id: true,
        takenAt: true,
        healthyCount: true,
        atRiskCount: true,
        criticalCount: true,
      },
    }),
  ]);

  const inputs: CompanyHealthInput[] = companies.map((c) => {
    const latestActivity = c.activities[0] ?? null;
    const primaryOpenDeal = c.deals.find((d) => d.isPrimary && d.status === "OPEN") ?? null;
    return {
      id: c.id,
      name: c.nomSociete ?? c.enseigne ?? c.siret,
      dernierContact: c.dernierContact,
      latestActivitySentiment: latestActivity?.sentiment ?? null,
      latestActivityDate: latestActivity?.date ?? null,
      wonDeals: c.deals
        .filter((d) => d.status === "WON")
        .map((d) => ({ closeDate: d.closeDate })),
      primaryOpenDeal: primaryOpenDeal ? { updatedAt: primaryOpenDeal.updatedAt } : null,
    };
  });

  const results = inputs.map((input) => evaluateCompanyHealth(input));
  const summary = summarizeHealth(results);
  const flagged = results
    .filter((r) => r.band !== "healthy")
    .sort((a, b) => a.score - b.score);

  const lastSnapshot = snapshots[0];

  return (
    <div>
      <PageHeader title="Thor" subtitle="Santé des comptes — signaux de désengagement" />
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">{summary.companyCount}</p>
              <p className="text-xs text-muted">Sociétés suivies</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum text-success">
                {summary.healthyCount}
              </p>
              <p className="text-xs text-muted">Saines</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum text-warning">
                {summary.atRiskCount}
              </p>
              <p className="text-xs text-muted">À risque</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum text-danger">
                {summary.criticalCount}
              </p>
              <p className="text-xs text-muted">Critiques</p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sociétés à surveiller</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {flagged.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Tout va bien"
                  hint="Aucune société ne présente de signal de désengagement pour le moment."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 font-semibold">Société</th>
                      <th className="px-4 py-2.5 font-semibold">Score</th>
                      <th className="px-4 py-2.5 font-semibold">Signaux</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.map((r) => (
                      <tr key={r.companyId} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-medium">
                          <Link href={`/companies/${r.companyId}`} className="hover:underline">
                            {r.companyName}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone={BAND_TONE[r.band]}>
                            {r.score} · {BAND_LABEL[r.band]}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {r.signals.map((signal) => (
                              <Badge key={signal.key} tone="neutral">
                                {signal.label}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dernière vérification</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {lastSnapshot ? (
              <>
                <p className="text-sm">{formatDate(lastSnapshot.takenAt)}</p>
                <div className="space-y-1">
                  {snapshots.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-xs text-muted">
                      <span>{formatDate(s.takenAt)}</span>
                      <span className="tnum">
                        {s.healthyCount} saines · {s.atRiskCount} à risque ·{" "}
                        {s.criticalCount} critiques
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                Aucun balayage planifié n&apos;a encore eu lieu.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

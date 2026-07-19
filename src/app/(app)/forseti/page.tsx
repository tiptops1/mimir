import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardBody, Badge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import {
  evaluateCompanyCompliance,
  summarizeCompliance,
  type ComplianceSeverity,
} from "@/lib/forseti/compliance";

// Forseti (S19) — compliance dashboard: live status (recomputed from
// Company.customFields on every load, so a missed cron never desyncs the UI)
// plus the last scheduled snapshot for "last checked" + a short trend. Same
// read-only posture as Nornir (src/app/(app)/nornir/page.tsx).

const SEVERITY_TONE: Record<ComplianceSeverity, "danger" | "warning" | "neutral"> = {
  expired: "danger",
  expiring: "warning",
  missing: "neutral",
};

const SEVERITY_LABEL: Record<ComplianceSeverity, string> = {
  expired: "Expiré",
  expiring: "À renouveler",
  missing: "Manquant",
};

export default async function ForsetiPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const [companies, snapshots] = await Promise.all([
    prisma.company.findMany({
      select: { id: true, nomSociete: true, enseigne: true, siret: true, customFields: true },
    }),
    prisma.complianceSnapshot.findMany({
      orderBy: { takenAt: "desc" },
      take: 5,
      select: {
        id: true,
        takenAt: true,
        expiredCount: true,
        expiringCount: true,
        missingCount: true,
      },
    }),
  ]);

  const results = companies.map((c) =>
    evaluateCompanyCompliance({
      id: c.id,
      name: c.nomSociete ?? c.enseigne ?? c.siret,
      customFields: c.customFields,
    }),
  );
  const summary = summarizeCompliance(results);
  const flagged = results
    .filter((r) => r.status !== "compliant")
    .sort((a, b) => {
      const order: Record<string, number> = { expired: 0, missing: 1, expiring: 2 };
      return order[a.status] - order[b.status];
    });

  const lastSnapshot = snapshots[0];

  return (
    <div>
      <PageHeader title="Forseti" subtitle="Conformité — ORIAS, RC Pro, KYC" />
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">{summary.compliantCount}</p>
              <p className="text-xs text-muted">Conformes</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum text-warning">
                {summary.expiringCount}
              </p>
              <p className="text-xs text-muted">À renouveler ({"<"} 30j)</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum text-danger">
                {summary.expiredCount}
              </p>
              <p className="text-xs text-muted">Expirés</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-2xl font-semibold tracking-tight tnum">{summary.missingCount}</p>
              <p className="text-xs text-muted">Manquants</p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sociétés à traiter</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {flagged.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Tout est en ordre"
                  hint="Aucune société ne présente d'écart de conformité pour le moment."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 font-semibold">Société</th>
                      <th className="px-4 py-2.5 font-semibold">Écarts</th>
                      <th className="px-4 py-2.5 font-semibold">Échéance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.map((r) => (
                      <tr key={r.companyId} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-medium">
                          <Link
                            href={`/companies/${r.companyId}`}
                            className="hover:underline"
                          >
                            {r.companyName}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            {r.issues.map((issue) => (
                              <Badge key={issue.key} tone={SEVERITY_TONE[issue.severity]}>
                                {issue.label} · {SEVERITY_LABEL[issue.severity]}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-muted tnum">
                          {r.issues.find((i) => i.dueDate)?.dueDate
                            ? formatDate(r.issues.find((i) => i.dueDate)!.dueDate)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Propositions en attente</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-sm text-muted">
                Les relances de conformité proposées par le balayage planifié attendent une
                approbation dans la boîte de réception des agents.
              </p>
              <Link
                href="/heimdallr/inbox?module=forseti"
                className="mt-2 inline-block text-xs font-medium text-brand hover:underline"
              >
                Ouvrir les approbations Forseti
              </Link>
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
                          {s.expiredCount} expirés · {s.expiringCount} à renouveler ·{" "}
                          {s.missingCount} manquants
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
    </div>
  );
}

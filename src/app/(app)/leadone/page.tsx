import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { quotaSnapshot } from "@/lib/leadone/quota";
import { approveCandidate, rejectCandidate } from "@/app/actions/leadone";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";

// Lead One — review queue for the automated lead-gen pipeline
// (scripts/leadone/, daily GitHub Actions run). Humans approve VALIDATED
// candidates into the CRM; everything upstream is machine-driven.

export const dynamic = "force-dynamic";

const STATUS_LABELS: Array<{ key: string; label: string }> = [
  { key: "SOURCED", label: "Sourcés" },
  { key: "ENRICHED_WEBSITE", label: "Site trouvé" },
  { key: "ENRICHED_CONTACT", label: "Contact extrait" },
  { key: "VALIDATED", label: "À valider" },
  { key: "PROMOTED", label: "Intégrés au CRM" },
  { key: "REJECTED", label: "Écartés" },
];

const SPECIALITY_LABELS: Record<string, string> = {
  sante: "Santé",
  prevoyance: "Prévoyance",
  iard: "IARD",
  auto: "Auto",
  rcPro: "RC Pro",
  entreprises: "Entreprises",
  collectives: "Collectives",
  particuliers: "Particuliers",
};

const PROVIDER_LABELS: Record<string, string> = {
  google_cse: "Google CSE (jour)",
  exa: "Exa.ai (mois)",
  hunter: "Hunter.io (mois)",
};

interface Dirigeant {
  nom?: string;
  prenom?: string;
  qualite?: string;
}

function linkedinSearchUrl(d: Dirigeant, companyName: string): string {
  const terms = [d.prenom, d.nom, companyName, "assurance"]
    .filter(Boolean)
    .join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(terms)}`;
}

export default async function LeadOnePage() {
  await verifySession();
  const prisma = await getTenantDb();

  const [statusCounts, quotas, lastRun, queue] = await Promise.all([
    prisma.leadCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    quotaSnapshot(prisma),
    prisma.leadOneRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.leadCandidate.findMany({
      where: { status: "VALIDATED" },
      orderBy: { confidence: "desc" },
      take: 100,
    }),
  ]);

  const countByStatus = new Map(
    statusCounts.map((s) => [s.status, s._count._all]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead One"
        subtitle="Génération automatique de leads — courtiers et intermédiaires d'assurance (registre NAF 66.22Z, enrichissement gratuit quotidien)."
      />

      {/* Pipeline counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATUS_LABELS.map((s) => (
          <Card key={s.key}>
            <CardBody className="py-3">
              <p className="text-xs text-muted">{s.label}</p>
              <p className="mt-1 text-xl font-semibold tnum">
                {countByStatus.get(s.key) ?? 0}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Free-tier quota gauges */}
        <Card>
          <CardHeader>
            <CardTitle>Quotas gratuits</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {quotas.length === 0 ? (
              <p className="text-sm text-muted">
                Aucun quota initialisé — le premier run du pipeline s&apos;en charge.
              </p>
            ) : (
              quotas.map((q) => {
                const pct = Math.min(100, Math.round((q.used / q.limit) * 100));
                return (
                  <div key={q.provider}>
                    <div className="flex items-center justify-between text-sm">
                      <span>{PROVIDER_LABELS[q.provider] ?? q.provider}</span>
                      <span className="text-muted tnum">
                        {q.used} / {q.limit}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                      <div
                        className={`h-1.5 rounded-full ${pct >= 100 ? "bg-danger" : "bg-brand"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>

        {/* Last run */}
        <Card>
          <CardHeader>
            <CardTitle>Dernier run</CardTitle>
          </CardHeader>
          <CardBody>
            {!lastRun ? (
              <p className="text-sm text-muted">
                Aucun run pour l&apos;instant — le pipeline tourne chaque jour à
                09h15 (Paris) via GitHub Actions.
              </p>
            ) : (
              <div className="space-y-1 text-sm">
                <p>
                  <span className="text-muted">Déclenché&nbsp;:</span>{" "}
                  {lastRun.startedAt.toLocaleString("fr-FR")} (
                  {lastRun.trigger === "CRON" ? "planifié" : "manuel"})
                </p>
                <p>
                  <span className="text-muted">Statut&nbsp;:</span>{" "}
                  {lastRun.finishedAt
                    ? lastRun.error
                      ? `terminé avec erreurs — ${lastRun.error}`
                      : "terminé"
                    : "en cours"}
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Review queue */}
      <Card>
        <CardHeader>
          <CardTitle>
            File de validation ({queue.length}
            {queue.length === 100 ? "+" : ""})
          </CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {queue.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Aucun lead à valider"
                hint="Les leads validés par le pipeline apparaîtront ici, triés par score de confiance."
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-medium">Société</th>
                  <th className="px-4 py-2 font-medium">Site web</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Téléphone</th>
                  <th className="px-4 py-2 font-medium">Spécialités</th>
                  <th className="px-4 py-2 font-medium">Score</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {queue.map((c) => {
                  const spec = (c.specialites ?? {}) as Record<string, boolean>;
                  const specKeys = Object.keys(SPECIALITY_LABELS).filter(
                    (k) => spec[k],
                  );
                  const companyName = c.enseigne || c.nomSociete || "";
                  const dirigeants = (c.dirigeants ?? []) as Dirigeant[];
                  return (
                    <tr key={c.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2">
                        <p className="font-medium">
                          {companyName || c.siret}
                        </p>
                        <a
                          href={`https://annuaire-entreprises.data.gouv.fr/entreprise/${c.siren ?? c.siret.slice(0, 9)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-muted hover:text-brand"
                        >
                          Registre · vérifier ORIAS
                        </a>
                        {dirigeants.map((d, i) => {
                          const name = [d.prenom, d.nom].filter(Boolean).join(" ");
                          if (!name) return null;
                          return (
                            <a
                              key={i}
                              href={linkedinSearchUrl(d, companyName)}
                              target="_blank"
                              rel="noreferrer"
                              className="block text-xs text-muted hover:text-brand"
                            >
                              {name} · LinkedIn
                            </a>
                          );
                        })}
                      </td>
                      <td className="px-4 py-2">
                        {c.siteWeb ? (
                          <a
                            href={c.siteWeb}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand hover:underline"
                          >
                            {c.siteWeb.replace(/^https?:\/\/(www\.)?/, "")}
                          </a>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {c.email ? (
                          <span className="inline-flex items-center gap-1.5">
                            {c.email}
                            <Badge
                              tone={
                                c.emailStatus === "MX_VALID"
                                  ? "success"
                                  : "warning"
                              }
                            >
                              {c.emailStatus === "MX_VALID" ? "MX ✓" : "syntaxe"}
                            </Badge>
                          </span>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 tnum">
                        {c.telephone ?? <span className="text-faint">—</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className="flex flex-wrap gap-1">
                          {specKeys.length ? (
                            specKeys.map((k) => (
                              <Badge key={k} tone="info">
                                {SPECIALITY_LABELS[k]}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          tone={
                            c.confidence >= 80
                              ? "success"
                              : c.confidence >= 60
                                ? "brand"
                                : "neutral"
                          }
                        >
                          {c.confidence}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          <form action={approveCandidate.bind(null, c.id)}>
                            <Button size="sm" type="submit">
                              Intégrer
                            </Button>
                          </form>
                          <form action={rejectCandidate.bind(null, c.id)}>
                            <Button size="sm" variant="ghost" type="submit">
                              Écarter
                            </Button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

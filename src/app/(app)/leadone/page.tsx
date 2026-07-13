import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { quotaSnapshot, QUOTA_DEFAULTS } from "@/lib/leadone/quota";
import { approveCandidate, rejectCandidate } from "@/app/actions/leadone";
import { PageHeader } from "@/components/page-header";
import { SPECIALTY_FIELDS } from "@/lib/constants";
import { buildLinkedinSearchUrl } from "@/lib/leadone/linkedin";
import { LeadOneFilters } from "@/components/leadone-filters";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import type { Prisma } from "@prisma/client";

// Lead One — review queue for the automated lead-gen pipeline
// (scripts/leadone/, daily GitHub Actions run). Humans approve VALIDATED
// candidates into the CRM; everything upstream is machine-driven.

export const dynamic = "force-dynamic";

const QUEUE_FETCH_CAP = 300;

const STATUS_LABELS: Array<{ key: string; label: string }> = [
  { key: "SOURCED", label: "Sourcés" },
  { key: "ENRICHED_WEBSITE", label: "Site trouvé" },
  { key: "ENRICHED_CONTACT", label: "Contact extrait" },
  { key: "VALIDATED", label: "À valider" },
  { key: "PROMOTED", label: "Intégrés au CRM" },
  { key: "REJECTED", label: "Écartés" },
];

// LeadCandidate.specialites keys → Company specialite* field keys, so the
// badges reuse the exact same colors as the Suivi (companies) page.
const SPECIALITY_FIELD_KEY: Record<string, string> = {
  sante: "specialiteSante",
  prevoyance: "specialitePrevoyance",
  iard: "specialiteIard",
  auto: "specialiteAuto",
  rcPro: "specialiteRcPro",
  entreprises: "specialiteEntreprises",
  collectives: "specialiteCollectives",
  particuliers: "specialiteParticuliers",
};

function specialityMeta(key: string) {
  const fieldKey = SPECIALITY_FIELD_KEY[key];
  return SPECIALTY_FIELDS.find((f) => f.key === fieldKey);
}

const PROVIDER_LABELS: Record<string, string> = {
  tavily: "Tavily (mois)",
  exa: "Exa.ai (mois)",
  hunter: "Hunter.io (mois)",
  serpapi: "SerpApi LinkedIn (mois)",
};

// GitHub Actions cron is "15 8 * * *" (UTC, see .github/workflows/leadone.yml).
function nextScheduledRun(): Date {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 15, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

interface Dirigeant {
  nom?: string;
  prenom?: string;
  qualite?: string;
  linkedinUrl?: string;
  linkedinChecked?: boolean;
}

export default async function LeadOnePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();

  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const fContact = str("contact");
  const fSociete = str("societe");
  const fEmail = str("email");
  const fSiteweb = str("siteweb"); // "with" | "without"
  const fTelephone = str("telephone"); // "with" | "without"
  const fLinkedin = str("linkedin"); // "verified" | "unverified"
  const fSpecialite = str("specialite");
  const fScore = str("score"); // "80" | "60" | "low"

  const where: Prisma.LeadCandidateWhereInput = {
    status: "VALIDATED",
    ...(fSociete
      ? {
          OR: [
            { nomSociete: { contains: fSociete, mode: "insensitive" } },
            { enseigne: { contains: fSociete, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(fEmail ? { email: { contains: fEmail, mode: "insensitive" } } : {}),
    ...(fSiteweb === "with"
      ? { siteWeb: { not: null } }
      : fSiteweb === "without"
        ? { siteWeb: null }
        : {}),
    ...(fTelephone === "with"
      ? { telephone: { not: null } }
      : fTelephone === "without"
        ? { telephone: null }
        : {}),
    ...(fScore === "80"
      ? { confidence: { gte: 80 } }
      : fScore === "60"
        ? { confidence: { gte: 60, lt: 80 } }
        : fScore === "low"
          ? { confidence: { lt: 60 } }
          : {}),
  };

  const [statusCounts, quotas, lastRun, rawQueue] = await Promise.all([
    prisma.leadCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    quotaSnapshot(prisma),
    prisma.leadOneRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.leadCandidate.findMany({
      where,
      orderBy: { confidence: "desc" },
      take: QUEUE_FETCH_CAP,
    }),
  ]);

  // Filters on dirigeants/specialites (JSON fields — not filterable in the
  // Mongo `where` above) apply here instead. The queue is a bounded review
  // inbox, not a paginated list, so filtering the fetched batch is enough.
  let queue = rawQueue;
  if (fContact) {
    const needle = fContact.toLowerCase();
    queue = queue.filter((c) =>
      ((c.dirigeants ?? []) as Dirigeant[]).some((d) =>
        `${d.prenom ?? ""} ${d.nom ?? ""}`.toLowerCase().includes(needle),
      ),
    );
  }
  if (fSpecialite) {
    queue = queue.filter((c) => {
      const spec = (c.specialites ?? {}) as Record<string, boolean>;
      return Boolean(spec[fSpecialite]);
    });
  }
  if (fLinkedin) {
    queue = queue.filter((c) => {
      const anyVerified = ((c.dirigeants ?? []) as Dirigeant[]).some((d) =>
        Boolean(d.linkedinUrl),
      );
      return fLinkedin === "verified" ? anyVerified : !anyVerified;
    });
  }

  const specialtyOptions = Object.keys(SPECIALITY_FIELD_KEY).map((key) => ({
    value: key,
    label: specialityMeta(key)?.label ?? key,
  }));

  // Always show every configured provider, even before its first pipeline
  // run has created a LeadOneQuota row (e.g. SerpApi right after setup).
  const quotaByProvider = new Map(quotas.map((q) => [q.provider, q]));
  const displayQuotas = Object.entries(QUOTA_DEFAULTS).map(([provider, def]) => ({
    provider,
    used: quotaByProvider.get(provider)?.used ?? 0,
    limit: quotaByProvider.get(provider)?.limit ?? def.limit,
  }));

  const nextRun = nextScheduledRun();

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
            {displayQuotas.map((q) => {
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
            })}
          </CardBody>
        </Card>

        {/* Last run */}
        <Card>
          <CardHeader>
            <CardTitle>Dernier run</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            {!lastRun ? (
              <p className="text-muted">Aucun run pour l&apos;instant.</p>
            ) : (
              <div className="space-y-1">
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
            <p className="border-t border-border pt-2">
              <span className="text-muted">Prochain run prévu&nbsp;:</span>{" "}
              {nextRun.toLocaleString("fr-FR", {
                timeZone: "Europe/Paris",
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              (chaque jour, automatique)
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Review queue */}
      <Card>
        <CardHeader>
          <CardTitle>
            File de validation ({queue.length}
            {rawQueue.length === QUEUE_FETCH_CAP ? "+" : ""})
          </CardTitle>
        </CardHeader>
        <CardBody className="p-4 pb-0">
          <LeadOneFilters specialtyOptions={specialtyOptions} />
        </CardBody>
        <CardBody className="p-0">
          {queue.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Aucun lead à valider"
                hint="Les leads validés par le pipeline apparaîtront ici, triés par score de confiance."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-medium">Société</th>
                    <th className="px-3 py-2 font-medium">Site web</th>
                    <th className="px-3 py-2 font-medium">Contact</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Téléphone</th>
                    <th className="px-3 py-2 font-medium">Spécialités</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                    <th className="px-3 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {queue.map((c) => {
                    const spec = (c.specialites ?? {}) as Record<string, boolean>;
                    const specKeys = Object.keys(SPECIALITY_FIELD_KEY).filter(
                      (k) => spec[k],
                    );
                    const companyName = c.enseigne || c.nomSociete || "";
                    const dirigeants = (c.dirigeants ?? []) as Dirigeant[];
                    return (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="max-w-[140px] px-3 py-2">
                          <p className="truncate font-medium" title={companyName || c.siret}>
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
                        </td>
                        <td className="max-w-[130px] px-3 py-2">
                          {c.siteWeb ? (
                            <a
                              href={c.siteWeb}
                              target="_blank"
                              rel="noreferrer"
                              title={c.siteWeb}
                              className="block truncate text-brand hover:underline"
                            >
                              {c.siteWeb.replace(/^https?:\/\/(www\.)?/, "")}
                            </a>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="max-w-[170px] px-3 py-2">
                          {dirigeants.length === 0 ? (
                            <span className="text-faint">—</span>
                          ) : (
                            dirigeants.map((d, i) => {
                              const name = [d.prenom, d.nom].filter(Boolean).join(" ");
                              if (!name) return null;
                              const verified = Boolean(d.linkedinUrl);
                              const href = verified
                                ? d.linkedinUrl!
                                : buildLinkedinSearchUrl(name, companyName);
                              const label = `${name}${d.qualite ? ` (${d.qualite})` : ""}`;
                              return (
                                <div key={i} className="flex items-center gap-1">
                                  <span className="min-w-0 truncate" title={label}>
                                    {name}
                                    {d.qualite && (
                                      <span className="ml-1 text-xs text-muted">
                                        ({d.qualite})
                                      </span>
                                    )}
                                  </span>
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    title={verified ? "Profil vérifié" : "Recherche LinkedIn (non vérifié)"}
                                    className={`shrink-0 hover:underline ${
                                      verified ? "font-medium text-brand" : "text-muted"
                                    }`}
                                  >
                                    · LinkedIn{verified ? " ✓" : ""}
                                  </a>
                                </div>
                              );
                            })
                          )}
                        </td>
                        <td className="max-w-[150px] px-3 py-2">
                          {c.email ? (
                            <span className="flex items-center gap-1.5">
                              <span className="truncate" title={c.email}>
                                {c.email}
                              </span>
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
                        <td className="whitespace-nowrap px-3 py-2 tnum">
                          {c.telephone ?? <span className="text-faint">—</span>}
                        </td>
                        <td className="min-w-[220px] px-3 py-2">
                          {specKeys.length ? (
                            <span className="flex flex-wrap gap-1">
                              {specKeys.map((k) => {
                                const meta = specialityMeta(k);
                                return (
                                  <Badge key={k} className={meta?.badge}>
                                    {meta?.label ?? k}
                                  </Badge>
                                );
                              })}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
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
                        <td className="px-3 py-2">
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
            </div>
          )}
        </CardBody>
      </Card>

      {/* Legend */}
      <Card>
        <CardHeader>
          <CardTitle>Comment lire ce tableau</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-medium">LinkedIn</p>
            <p className="text-muted">
              <span className="font-medium text-brand">Bleu</span> = vrai profil
              trouvé et confirmé. <span className="text-muted">Gris</span> = pas
              confirmé, le lien ouvre juste une recherche à vérifier soi-même.
            </p>
          </div>
          <div>
            <p className="font-medium">Score</p>
            <p className="text-muted">
              Note de fiabilité du lead sur 100.{" "}
              <Badge tone="success">≥ 80</Badge> fiable ·{" "}
              <Badge tone="brand">≥ 60</Badge> correct ·{" "}
              <Badge tone="neutral">&lt; 60</Badge> à vérifier avant de contacter.
            </p>
          </div>
          <div>
            <p className="font-medium">MX</p>
            <p className="text-muted">
              Indique si l&apos;email a des chances d&apos;être valide.{" "}
              <Badge tone="success">MX ✓</Badge> l&apos;adresse est fiable.{" "}
              <Badge tone="warning">syntaxe</Badge> l&apos;adresse a la bonne
              forme mais n&apos;a pas pu être vérifiée.
            </p>
          </div>
          <div>
            <p className="font-medium">Registre · vérifier ORIAS</p>
            <p className="text-muted">
              Ouvre la fiche officielle de l&apos;entreprise. Servez-vous-en pour
              vérifier vous-même qu&apos;elle est bien inscrite au registre
              ORIAS avant d&apos;intégrer le lead.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

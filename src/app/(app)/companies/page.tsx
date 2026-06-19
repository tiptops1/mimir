import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton, Card, EmptyState, Input, Select } from "@/components/ui";
import { StageBadge, PrioriteBadge, PotentielBadge } from "@/components/badges";
import {
  companyName,
  contactName,
  personLinkedInSearch,
  companyLinkedInSearch,
} from "@/lib/display";
import {
  PIPELINE_STAGES,
  PRIORITE_OPTIONS,
  POTENTIEL_OPTIONS,
  CANAL_PREFERE_OPTIONS,
  SPECIALTY_FIELDS,
} from "@/lib/constants";
import { PreferredChannelSelect } from "@/components/preferred-channel-select";

type DmContact = {
  nom: string | null;
  prenom: string | null;
  email: string | null;
  telephone: string | null;
  linkedinUrl: string | null;
  isDecisionMaker: boolean | null;
};

/** Pick the flagged decision-maker, else the first contact. */
function decisionMaker(contacts: DmContact[]) {
  if (contacts.length === 0) return null;
  return contacts.find((c) => c.isDecisionMaker) ?? contacts[0];
}

const PAGE_SIZE = 20;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const stage = typeof sp.stage === "string" ? sp.stage : "";
  const priorite = typeof sp.priorite === "string" ? sp.priorite : "";
  const potentiel = typeof sp.potentiel === "string" ? sp.potentiel : "";
  const canal = typeof sp.canal === "string" ? sp.canal : "";
  const site = typeof sp.site === "string" ? sp.site : "";
  const specialite = typeof sp.specialite === "string" ? sp.specialite : "";
  const page = Math.max(1, Number.parseInt((sp.page as string) ?? "1", 10) || 1);

  const where: Prisma.CompanyWhereInput = {};
  if (q) {
    where.OR = [
      { nomSociete: { contains: q, mode: "insensitive" } },
      { enseigne: { contains: q, mode: "insensitive" } },
      { ville: { contains: q, mode: "insensitive" } },
      { siret: { contains: q } },
      { siren: { contains: q } },
    ];
  }
  if (stage) where.stage = stage as Prisma.CompanyWhereInput["stage"];
  if (priorite) where.priorite = priorite as Prisma.CompanyWhereInput["priorite"];
  if (potentiel) where.potentiel = potentiel as Prisma.CompanyWhereInput["potentiel"];
  if (canal) where.canalPrefere = canal;
  if (SPECIALTY_FIELDS.some((s) => s.key === specialite)) {
    (where as Record<string, unknown>)[specialite] = true;
  }
  // "Avec / sans site web" — treat empty strings the same as null.
  if (site === "with") {
    where.AND = [{ siteWeb: { not: null } }, { siteWeb: { not: "" } }];
  } else if (site === "without") {
    where.AND = [{ OR: [{ siteWeb: null }, { siteWeb: "" }] }];
  }

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        _count: { select: { contacts: true } },
        contacts: {
          select: {
            nom: true,
            prenom: true,
            email: true,
            telephone: true,
            linkedinUrl: true,
            isDecisionMaker: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.company.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (priorite) params.set("priorite", priorite);
    if (potentiel) params.set("potentiel", potentiel);
    if (canal) params.set("canal", canal);
    if (site) params.set("site", site);
    if (specialite) params.set("specialite", specialite);
    for (const [k, v] of Object.entries(overrides)) params.set(k, String(v));
    return `?${params.toString()}`;
  };

  const hasFilters = Boolean(
    q || stage || priorite || potentiel || canal || site || specialite,
  );

  return (
    <div>
      <PageHeader
        title="Sociétés"
        subtitle={`${total} société${total > 1 ? "s" : ""} de courtage`}
      >
        <LinkButton href="/companies/new">+ Nouvelle société</LinkButton>
      </PageHeader>

      <div className="p-6">
        <form className="mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Rechercher nom, ville, SIRET…"
            />
          </div>
          <Select name="stage" defaultValue={stage} className="w-52">
            <option value="">Toutes les étapes</option>
            {PIPELINE_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select name="priorite" defaultValue={priorite} className="w-44">
            <option value="">Toutes priorités</option>
            {PRIORITE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select name="potentiel" defaultValue={potentiel} className="w-40">
            <option value="">Tout potentiel</option>
            {POTENTIEL_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select name="canal" defaultValue={canal} className="w-44">
            <option value="">Tout canal</option>
            {CANAL_PREFERE_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select name="specialite" defaultValue={specialite} className="w-44">
            <option value="">Toutes spécialités</option>
            {SPECIALTY_FIELDS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
          <Select name="site" defaultValue={site} className="w-40">
            <option value="">Site web : tous</option>
            <option value="with">Avec site web</option>
            <option value="without">Sans site web</option>
          </Select>
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Filtrer
          </button>
          {hasFilters && (
            <Link
              href="/companies"
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-foreground"
            >
              Réinitialiser
            </Link>
          )}
        </form>

        {companies.length === 0 ? (
          <EmptyState
            title="Aucune société trouvée"
            hint="Ajustez vos filtres ou ajoutez une nouvelle société."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Société</th>
                    <th className="px-4 py-3 font-medium">Décideur</th>
                    <th className="px-4 py-3 font-medium">Communication préférée</th>
                    <th className="px-4 py-3 font-medium">Étape</th>
                    <th className="px-4 py-3 font-medium">Priorité</th>
                    <th className="px-4 py-3 font-medium">Potentiel</th>
                    <th className="px-4 py-3 font-medium">Contacts</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border last:border-0 hover:bg-slate-50/60"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/companies/${c.id}`}
                          className="font-medium text-foreground hover:text-brand"
                        >
                          {companyName(c)}
                        </Link>
                        <div className="text-xs text-muted">{c.siret}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {(() => {
                          const dm = decisionMaker(c.contacts);
                          return dm ? contactName(dm) : "—";
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const dm = decisionMaker(c.contacts);
                          const linkedinHref =
                            dm?.linkedinUrl ||
                            (dm
                              ? personLinkedInSearch(dm, c)
                              : companyLinkedInSearch(c));
                          return (
                            <PreferredChannelSelect
                              id={c.id}
                              value={c.canalPrefere}
                              phone={dm?.telephone ?? c.telephoneStandard}
                              email={dm?.email ?? c.emailGenerique}
                              linkedinHref={linkedinHref}
                              linkedinLabel={
                                dm?.linkedinUrl ? "Profil ↗" : "Rechercher ↗"
                              }
                            />
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <StageBadge stage={c.stage} />
                      </td>
                      <td className="px-4 py-3">
                        <PrioriteBadge priorite={c.priorite} />
                      </td>
                      <td className="px-4 py-3">
                        <PotentielBadge potentiel={c.potentiel} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {c._count.contacts}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted">
              Page {page} sur {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={qs({ page: page - 1 })}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-slate-50"
                >
                  Précédent
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={qs({ page: page + 1 })}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-slate-50"
                >
                  Suivant
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

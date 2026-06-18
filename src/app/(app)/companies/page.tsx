import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton, Card, EmptyState, Input, Select } from "@/components/ui";
import { StageBadge, PrioriteBadge, PotentielBadge } from "@/components/badges";
import { companyName } from "@/lib/display";
import { PIPELINE_STAGES, PRIORITE_OPTIONS } from "@/lib/constants";

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

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { contacts: true } } },
    }),
    prisma.company.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (priorite) params.set("priorite", priorite);
    for (const [k, v] of Object.entries(overrides)) params.set(k, String(v));
    return `?${params.toString()}`;
  };

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
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Filtrer
          </button>
          {(q || stage || priorite) && (
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
                    <th className="px-4 py-3 font-medium">Ville</th>
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
                        {c.ville ?? "—"}
                        {c.codePostal ? (
                          <span className="text-xs text-muted">
                            {" "}
                            ({c.codePostal})
                          </span>
                        ) : null}
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

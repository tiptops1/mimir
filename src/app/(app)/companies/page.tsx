import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LinkButton, Card, EmptyState, Input, Select } from "@/components/ui";
import { companyName, contactName } from "@/lib/display";
import {
  PIPELINE_STAGES,
  PRIORITE_OPTIONS,
  POTENTIEL_OPTIONS,
  CANAL_PREFERE_OPTIONS,
  SPECIALTY_FIELDS,
} from "@/lib/constants";
import { SpecialtiesCell } from "@/components/specialties-cell";
import { NotesCell } from "@/components/notes-cell";
import { EnumCell } from "@/components/enum-cell";

const STAGE_OPTIONS = PIPELINE_STAGES.map((s) => ({
  value: s.value,
  label: s.label,
  badge: s.badge,
  dot: s.dot,
}));
const PRIORITE_CELL_OPTIONS = PRIORITE_OPTIONS.map((p) => ({
  value: p.value,
  label: p.label,
  short: p.value,
  badge: p.badge,
}));
const POTENTIEL_CELL_OPTIONS = POTENTIEL_OPTIONS.map((p) => ({
  value: p.value,
  label: p.label,
}));

type DmContact = {
  nom: string | null;
  prenom: string | null;
  isDecisionMaker: boolean | null;
};

/** Pick the flagged decision-maker, else the first contact. */
function decisionMaker(contacts: DmContact[]) {
  if (contacts.length === 0) return null;
  return contacts.find((c) => c.isDecisionMaker) ?? contacts[0];
}

/** Days-since-last-touch label — only when there's a clear touchpoint. */
function touchLabel(date: Date | null | undefined): {
  text: string;
  cls: string;
} {
  if (!date) return { text: "—", cls: "text-slate-300" };
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  const text =
    days <= 0 ? "Aujourd'hui" : days === 1 ? "Hier" : `Il y a ${days} j`;
  // Warm color as the touch goes stale.
  const cls =
    days <= 7
      ? "text-emerald-600"
      : days <= 30
        ? "text-amber-600"
        : "text-rose-600";
  return { text, cls };
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
  const dept = typeof sp.dept === "string" ? sp.dept : "";
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
  if (/^\d{2}$/.test(dept)) where.codePostal = { startsWith: dept };
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
            isDecisionMaker: true,
          },
          orderBy: { createdAt: "asc" },
        },
        activities: {
          select: { date: true },
          orderBy: { date: "desc" },
          take: 1,
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
    if (dept) params.set("dept", dept);
    for (const [k, v] of Object.entries(overrides)) params.set(k, String(v));
    return `?${params.toString()}`;
  };

  const hasFilters = Boolean(
    q || stage || priorite || potentiel || canal || site || specialite || dept,
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
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Spécialités</th>
                    <th className="px-4 py-3 font-medium">Notes / prochaines étapes</th>
                    <th className="px-4 py-3 font-medium">Étape</th>
                    <th className="px-4 py-3 font-medium">Priorité</th>
                    <th className="px-4 py-3 font-medium">Potentiel</th>
                    <th className="px-4 py-3 font-medium">Dernier contact</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => {
                    const dm = decisionMaker(c.contacts);
                    const hasContact = Boolean(dm && (dm.prenom || dm.nom));
                    const activeSpec = SPECIALTY_FIELDS.filter(
                      (f) => c[f.key as keyof typeof c],
                    ).map((f) => f.key);
                    const lastTouch =
                      c.dernierContact ?? c.activities[0]?.date ?? null;
                    const touch = touchLabel(lastTouch);
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-border last:border-0 align-top hover:bg-slate-50/60"
                      >
                        <td className="px-4 py-3">
                          <Link href={`/companies/${c.id}`} className="block">
                            <span className="font-medium text-foreground hover:text-brand">
                              {hasContact ? contactName(dm!) : companyName(c)}
                            </span>
                            <span
                              className={`mt-0.5 block text-xs ${
                                hasContact ? "text-sky-500" : "text-muted"
                              }`}
                            >
                              {hasContact ? companyName(c) : c.siret}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <SpecialtiesCell id={c.id} active={activeSpec} />
                        </td>
                        <td className="px-4 py-3">
                          <NotesCell id={c.id} value={c.notes} />
                        </td>
                        <td className="px-4 py-3">
                          <EnumCell
                            id={c.id}
                            field="stage"
                            value={c.stage}
                            options={STAGE_OPTIONS}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <EnumCell
                            id={c.id}
                            field="priorite"
                            value={c.priorite}
                            options={PRIORITE_CELL_OPTIONS}
                            nullable
                          />
                        </td>
                        <td className="px-4 py-3">
                          <EnumCell
                            id={c.id}
                            field="potentiel"
                            value={c.potentiel}
                            options={POTENTIEL_CELL_OPTIONS}
                            nullable
                          />
                        </td>
                        <td className={`px-4 py-3 text-xs font-medium ${touch.cls}`}>
                          {touch.text}
                        </td>
                      </tr>
                    );
                  })}
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

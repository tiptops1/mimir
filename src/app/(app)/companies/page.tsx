import Link from "next/link";
import { Download } from "lucide-react";
import { getTenantDb } from "@/lib/tenant-context";
import { buildCompanyWhere } from "@/lib/list-filters";
import { PageHeader } from "@/components/page-header";
import { LinkButton, Card, EmptyState } from "@/components/ui";
import { CompaniesFilters } from "@/components/companies-filters";
import { companyName, contactName } from "@/lib/display";
import {
  PRIORITE_OPTIONS,
  POTENTIEL_OPTIONS,
  SPECIALTY_FIELDS,
} from "@/lib/constants";
import { getStageDefs } from "@/lib/stage-config";
import { SpecialtiesCell } from "@/components/specialties-cell";
import { NotesCell } from "@/components/notes-cell";
import { EnumCell } from "@/components/enum-cell";

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
  if (!date) return { text: "—", cls: "text-faint" };
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
  const prisma = await getTenantDb();
  const stageDefs = await getStageDefs();
  const stageOptions = stageDefs.map((s) => ({
    value: s.value,
    label: s.label,
    badge: s.badge,
    dot: s.dot,
  }));
  const sp = await searchParams;
  const societe = typeof sp.societe === "string" ? sp.societe : "";
  const nom = typeof sp.nom === "string" ? sp.nom : "";
  const contact = typeof sp.contact === "string" ? sp.contact : "";
  const stage = typeof sp.stage === "string" ? sp.stage : "";
  const priorite = typeof sp.priorite === "string" ? sp.priorite : "";
  const potentiel = typeof sp.potentiel === "string" ? sp.potentiel : "";
  const canal = typeof sp.canal === "string" ? sp.canal : "";
  const site = typeof sp.site === "string" ? sp.site : "";
  const specialite = typeof sp.specialite === "string" ? sp.specialite : "";
  const dept = typeof sp.dept === "string" ? sp.dept : "";
  const all = sp.all === "1";
  const page = Math.max(1, Number.parseInt((sp.page as string) ?? "1", 10) || 1);

  // Shared with /api/export so the CSV always matches the on-screen list.
  const { where, and } = buildCompanyWhere(sp);

  const [companies, total, totalAll] = await Promise.all([
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
    // Same filters, no engagement gate — lets us show how many are hidden.
    prisma.company.count({ where: { ...where, AND: and } }),
  ]);

  const hiddenCount = Math.max(0, totalAll - (all ? totalAll : total));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (societe) params.set("societe", societe);
    if (nom) params.set("nom", nom);
    if (contact) params.set("contact", contact);
    if (stage) params.set("stage", stage);
    if (priorite) params.set("priorite", priorite);
    if (potentiel) params.set("potentiel", potentiel);
    if (canal) params.set("canal", canal);
    if (site) params.set("site", site);
    if (specialite) params.set("specialite", specialite);
    if (dept) params.set("dept", dept);
    if (all) params.set("all", "1");
    for (const [k, v] of Object.entries(overrides)) params.set(k, String(v));
    return `?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Suivi"
        subtitle={
          all
            ? `${total} société${total > 1 ? "s" : ""} (toutes)`
            : `${total} prospect${total > 1 ? "s" : ""} engagé${total > 1 ? "s" : ""}`
        }
      >
        <a
          href={`/api/export${qs({ type: "companies" })}`}
          download
          className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-border-strong hover:bg-surface-2"
        >
          <Download className="h-4 w-4 text-faint" />
          Exporter
        </a>
        <LinkButton href="/contacts/new">+ Nouveau contact</LinkButton>
      </PageHeader>

      <div className="p-6">
        <CompaniesFilters stages={stageDefs} />

        {all ? (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm text-muted">
            <span>Toutes les sociétés, y compris celles sans engagement.</span>
            <Link href={qs({ page: 1, all: "" })} className="font-medium text-brand hover:underline">
              Voir seulement les prospects engagés
            </Link>
          </div>
        ) : hiddenCount > 0 ? (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm text-muted">
            <span>
              {hiddenCount} société{hiddenCount > 1 ? "s" : ""} masquée
              {hiddenCount > 1 ? "s" : ""} (sans engagement).
            </span>
            <Link href={qs({ page: 1, all: "1" })} className="font-medium text-brand hover:underline">
              Tout afficher
            </Link>
          </div>
        ) : null}

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
                  <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2.5 font-semibold">Contact</th>
                    <th className="px-4 py-2.5 font-semibold">Spécialités</th>
                    <th className="px-4 py-2.5 font-semibold">Notes / prochaines étapes</th>
                    <th className="px-4 py-2.5 font-semibold">Étape</th>
                    <th className="px-4 py-2.5 font-semibold">Priorité</th>
                    <th className="px-4 py-2.5 font-semibold">Potentiel</th>
                    <th className="px-4 py-2.5 font-semibold">Dernier contact</th>
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
                        className="border-b border-border last:border-0 align-top transition-colors hover:bg-surface-2/70"
                      >
                        <td className="px-4 py-3">
                          <Link href={`/companies/${c.id}`} className="block">
                            <span className="font-medium text-foreground hover:text-brand">
                              {hasContact ? contactName(dm!) : companyName(c)}
                            </span>
                            <span
                              className={`mt-0.5 block text-xs ${
                                hasContact ? "text-muted" : "text-faint tnum"
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
                            options={stageOptions}
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
                  className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium transition-colors hover:bg-surface-2 hover:border-border-strong"
                >
                  Précédent
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={qs({ page: page + 1 })}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium transition-colors hover:bg-surface-2 hover:border-border-strong"
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

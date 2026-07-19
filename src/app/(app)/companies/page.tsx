import { Suspense, ViewTransition } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { buildCompanyWhere } from "@/lib/list-filters";
import { PageHeader } from "@/components/page-header";
import { LinkButton } from "@/components/ui";
import { CompaniesFilters } from "@/components/companies-filters";
import { getStageDefs } from "@/lib/stage-config";
import { SavedViews } from "@/components/saved-views";
import { CompaniesTable } from "@/components/companies-table";
import { TableSkeleton } from "@/components/table-skeleton";

const PAGE_SIZE = 20;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const stageDefs = await getStageDefs();
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

  const [total, totalAll, savedViews, activeSequences] = await Promise.all([
    prisma.company.count({ where }),
    // Same filters, no engagement gate — lets us show how many are hidden.
    prisma.company.count({ where: { ...where, AND: and } }),
    prisma.savedView.findMany({
      where: { userId: session.userId, page: "companies" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, query: true },
    }),
    // Bulk bar's "Enrôler dans une séquence" picker — active sequences only,
    // both modes (TASKS creates worklist items, AUTO_EMAIL sends).
    prisma.sequence.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, mode: true },
    }),
  ]);
  const bulkSequences = activeSequences.map((s) => ({
    id: s.id,
    label: s.mode === "AUTO_EMAIL" ? `${s.name} · envoi auto` : s.name,
  }));

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
        <SavedViews page="companies" views={savedViews} />
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

        <Suspense
          fallback={
            <ViewTransition exit="slide-down" default="none">
              <TableSkeleton columns={8} />
            </ViewTransition>
          }
        >
          <ViewTransition enter="slide-up" default="none">
            <CompaniesTable where={where} page={page} bulkSequences={bulkSequences} />
          </ViewTransition>
        </Suspense>

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

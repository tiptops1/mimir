import { Suspense, ViewTransition } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { buildContactWhere } from "@/lib/list-filters";
import { PageHeader } from "@/components/page-header";
import { ContactsFilters } from "@/components/contacts-filters";
import { SavedViews } from "@/components/saved-views";
import { ContactsTable } from "@/components/contacts-table";
import { TableSkeleton } from "@/components/table-skeleton";

const PAGE_SIZE = 25;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const sp = await searchParams;
  const societe = typeof sp.societe === "string" ? sp.societe : "";
  const nom = typeof sp.nom === "string" ? sp.nom : "";
  const contact = typeof sp.contact === "string" ? sp.contact : "";
  const role = typeof sp.role === "string" ? sp.role : "";
  const has = typeof sp.has === "string" ? sp.has : "";
  const site = typeof sp.site === "string" ? sp.site : "";
  const page = Math.max(1, Number.parseInt((sp.page as string) ?? "1", 10) || 1);

  // Shared with /api/export so the CSV always matches the on-screen list.
  const where = buildContactWhere(sp);

  const [total, savedViews] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.savedView.findMany({
      where: { userId: session.userId, page: "contacts" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, query: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasFilters = Boolean(societe || nom || contact || role || has || site);
  const qs = (overrides: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (societe) params.set("societe", societe);
    if (nom) params.set("nom", nom);
    if (contact) params.set("contact", contact);
    if (role) params.set("role", role);
    if (has) params.set("has", has);
    if (site) params.set("site", site);
    for (const [k, v] of Object.entries(overrides)) params.set(k, String(v));
    return `?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${total} contact${total > 1 ? "s" : ""}`}
      >
        <a
          href={`/api/export${qs({ type: "contacts" })}`}
          download
          className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground shadow-xs transition-colors hover:border-border-strong hover:bg-surface-2"
        >
          <Download className="h-4 w-4 text-faint" />
          Exporter
        </a>
      </PageHeader>
      <div className="p-6">
        <SavedViews page="contacts" views={savedViews} />
        <ContactsFilters />

        <Suspense
          fallback={
            <ViewTransition exit="slide-down" default="none">
              <TableSkeleton columns={8} />
            </ViewTransition>
          }
        >
          <ViewTransition enter="slide-up" default="none">
            <ContactsTable where={where} page={page} hasFilters={hasFilters} />
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
                  className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  Précédent
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={qs({ page: page + 1 })}
                  className="rounded-lg border border-border bg-card px-3 py-1.5 font-medium transition-colors hover:border-border-strong hover:bg-surface-2"
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

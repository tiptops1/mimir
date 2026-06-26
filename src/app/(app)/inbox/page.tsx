import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, Badge } from "@/components/ui";
import { PendingRow } from "@/components/inbox-actions";
import { InboxFilters } from "@/components/inbox-filters";
import { companyName } from "@/lib/display";
import { emailDomain } from "@/lib/email-sync";
import { formatDate } from "@/lib/utils";
import { getTenantConfig } from "@/lib/tenant-config";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();
  const { owner } = getTenantConfig();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const dir = typeof sp.dir === "string" ? sp.dir : "";
  const min = Math.max(0, Number.parseInt((sp.min as string) ?? "", 10) || 0);
  const seen = typeof sp.seen === "string" ? sp.seen : "";

  const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
  // Each active filter is one AND clause, combinable like the other list pages.
  const and: Prisma.PendingContactWhereInput[] = [{ status: "PENDING" }];
  if (q) and.push({ OR: [{ email: ci(q) }, { name: ci(q) }, { sampleSubject: ci(q) }] });
  if (dir === "INBOUND" || dir === "OUTBOUND") and.push({ direction: dir });
  if (min > 0) and.push({ messageCount: { gte: min } });
  const seenDays = Number.parseInt(seen, 10);
  if (seenDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - seenDays);
    and.push({ lastSeen: { gte: since } });
  }

  const hasFilters = Boolean(q || dir || min > 0 || seenDays > 0);

  const [pending, totalPending, companiesRaw] = await Promise.all([
    prisma.pendingContact.findMany({
      where: { AND: and },
      orderBy: { lastSeen: "desc" },
    }),
    prisma.pendingContact.count({ where: { status: "PENDING" } }),
    prisma.company.findMany({
      select: { id: true, nomSociete: true, enseigne: true, siret: true },
      orderBy: { nomSociete: "asc" },
    }),
  ]);

  const companies = companiesRaw.map((c) => ({ id: c.id, name: companyName(c) }));

  return (
    <div>
      <PageHeader
        title="Boîte de réception"
        subtitle={
          hasFilters
            ? `${pending.length} sur ${totalPending} expéditeur${totalPending > 1 ? "s" : ""} à valider`
            : `${totalPending} expéditeur${totalPending > 1 ? "s" : ""} à valider`
        }
      />
      <div className="p-6">
        <p className="mb-4 max-w-2xl text-sm text-muted">
          Adresses vues dans les emails de {owner.name} qui ne correspondent à
          aucun contact. Approuvez pour créer un contact (rattaché à une société
          existante ou à une nouvelle), ou ignorez.
        </p>

        <InboxFilters />

        {pending.length === 0 ? (
          <EmptyState
            title={hasFilters ? "Aucun résultat" : "Rien à valider"}
            hint={
              hasFilters
                ? "Aucun expéditeur ne correspond à ces filtres. Réinitialisez pour tout voir."
                : "Les nouveaux expéditeurs apparaîtront ici après la synchronisation des emails."
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-4 py-3 font-medium">Expéditeur</th>
                    <th className="px-4 py-3 font-medium">Messages</th>
                    <th className="px-4 py-3 font-medium">Dernier sujet</th>
                    <th className="px-4 py-3 font-medium">Vu le</th>
                    <th className="px-4 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => (
                    <tr
                      key={p.id}
                      className="border-b border-border last:border-0 align-top hover:bg-surface-2/60"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.name || p.email}</p>
                        {p.name && (
                          <p className="text-xs text-muted">{p.email}</p>
                        )}
                        <Badge className="mt-1 bg-surface-2 text-muted">
                          {p.direction === "OUTBOUND" ? "↗ Envoyé" : "↘ Reçu"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {p.messageCount}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        <span className="line-clamp-2 max-w-xs">
                          {p.sampleSubject || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {formatDate(p.lastSeen)}
                      </td>
                      <td className="px-4 py-3">
                        <PendingRow
                          id={p.id}
                          domain={emailDomain(p.email) ?? p.email}
                          defaultTitle={`Relancer ${p.name || p.email}`}
                          companies={companies}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

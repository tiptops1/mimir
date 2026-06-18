import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, Badge } from "@/components/ui";
import { PendingRow } from "@/components/inbox-actions";
import { companyName } from "@/lib/display";
import { emailDomain } from "@/lib/email-sync";
import { formatDate } from "@/lib/utils";

export default async function InboxPage() {
  await verifySession();

  const [pending, companiesRaw] = await Promise.all([
    prisma.pendingContact.findMany({
      where: { status: "PENDING" },
      orderBy: { lastSeen: "desc" },
    }),
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
        subtitle={`${pending.length} expéditeur${pending.length > 1 ? "s" : ""} à valider`}
      />
      <div className="p-6">
        <p className="mb-4 max-w-2xl text-sm text-muted">
          Adresses vues dans les emails de Christopher qui ne correspondent à
          aucun contact. Approuvez pour créer un contact (rattaché à une société
          existante ou à une nouvelle), ou ignorez.
        </p>

        {pending.length === 0 ? (
          <EmptyState
            title="Rien à valider"
            hint="Les nouveaux expéditeurs apparaîtront ici après la synchronisation des emails."
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
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
                      className="border-b border-border last:border-0 align-top hover:bg-slate-50/60"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{p.name || p.email}</p>
                        {p.name && (
                          <p className="text-xs text-muted">{p.email}</p>
                        )}
                        <Badge className="mt-1 bg-slate-100 text-slate-600">
                          {p.direction === "OUTBOUND" ? "↗ Envoyé" : "↘ Reçu"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {p.messageCount}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <span className="line-clamp-2 max-w-xs">
                          {p.sampleSubject || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {formatDate(p.lastSeen)}
                      </td>
                      <td className="px-4 py-3">
                        <PendingRow
                          id={p.id}
                          domain={emailDomain(p.email) ?? p.email}
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

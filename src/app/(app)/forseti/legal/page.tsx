import Link from "next/link";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardHeader, CardTitle, CardBody, Badge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { ForsetiLegalForm } from "@/components/forseti-legal-form";

// Forseti legal drafting (S23) — paste-text draft entry point + a read-only
// list of ACTIVE LegalDocument rows. Approvals happen in the generic
// Heimdallr inbox, same posture as the compliance-task flow on /forseti.

const DOC_TYPE_LABEL: Record<string, string> = {
  contract_review: "Revue de contrat",
  terms_draft: "Rédaction de conditions",
};

export default async function ForsetiLegalPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const [companies, documents] = await Promise.all([
    prisma.company.findMany({
      select: { id: true, nomSociete: true, enseigne: true, siret: true },
      orderBy: { nomSociete: "asc" },
    }),
    prisma.legalDocument.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const companyOptions = companies.map((c) => ({
    id: c.id,
    name: c.nomSociete ?? c.enseigne ?? c.siret,
  }));
  const companyNameById = new Map(companyOptions.map((c) => [c.id, c.name]));

  return (
    <div>
      <PageHeader
        title="Forseti — Juridique"
        subtitle="Revue de contrat et rédaction de conditions (brouillon, jamais d'envoi automatique)"
      />
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <Link href="/forseti" className="text-xs font-medium text-muted hover:underline">
            ← Conformité
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Nouveau brouillon</CardTitle>
          </CardHeader>
          <CardBody>
            {companyOptions.length === 0 ? (
              <EmptyState
                title="Aucune société"
                hint="Créez une société avant de rédiger un document juridique."
              />
            ) : (
              <ForsetiLegalForm companies={companyOptions} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Documents actifs</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {documents.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Aucun document pour le moment"
                  hint="Les brouillons approuvés apparaîtront ici, par société."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 font-semibold">Société</th>
                      <th className="px-4 py-2.5 font-semibold">Type</th>
                      <th className="px-4 py-2.5 font-semibold">Titre</th>
                      <th className="px-4 py-2.5 font-semibold">Version</th>
                      <th className="px-4 py-2.5 font-semibold">Créé le</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((d) => (
                      <tr key={d.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 font-medium">
                          <Link href={`/companies/${d.entityId}`} className="hover:underline">
                            {companyNameById.get(d.entityId) ?? d.entityId}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge tone="neutral">{DOC_TYPE_LABEL[d.docType] ?? d.docType}</Badge>
                        </td>
                        <td className="px-4 py-2.5">{d.title}</td>
                        <td className="px-4 py-2.5 tnum">v{d.version}</td>
                        <td className="px-4 py-2.5 text-muted tnum">{formatDate(d.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

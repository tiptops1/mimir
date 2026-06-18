import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle, Badge } from "@/components/ui";
import { StageBadge, PrioriteBadge, PotentielBadge } from "@/components/badges";
import {
  AddActivityForm,
  AddContactForm,
  ContactDeleteButton,
  DeleteCompanyButton,
} from "@/components/company-detail-actions";
import { companyName, contactName } from "@/lib/display";
import { formatDate } from "@/lib/utils";
import { SPECIALTY_FIELDS, ACTIVITY_TYPES } from "@/lib/constants";

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

const activityLabel = (t: string) =>
  ACTIVITY_TYPES.find((a) => a.value === t)?.label ?? t;

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      activities: {
        orderBy: { date: "desc" },
        include: { user: { select: { name: true } } },
      },
    },
  });
  if (!company) notFound();

  const activeSpecialties = SPECIALTY_FIELDS.filter(
    (f) => company[f.key as keyof typeof company],
  );

  return (
    <div>
      <PageHeader title={companyName(company)} subtitle={company.siret}>
        <Link
          href={`/companies/${company.id}/edit`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" /> Modifier
        </Link>
        <DeleteCompanyButton id={company.id} />
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Informations</CardTitle>
              <StageBadge stage={company.stage} />
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Enseigne" value={company.enseigne} />
                <Field label="Catégorie" value={company.categorieEntreprise} />
                <Field label="Forme juridique" value={company.formeJuridique} />
                <Field
                  label="Date de création"
                  value={formatDate(company.dateCreation)}
                />
                <Field label="Code NAF" value={company.codeNaf} />
                <Field label="Tranche effectifs" value={company.trancheEffectifs} />
                <Field
                  label="Adresse"
                  value={[company.adresse, company.codePostal, company.ville]
                    .filter(Boolean)
                    .join(", ")}
                />
                <Field label="Site web" value={company.siteWeb} />
                <Field label="Email" value={company.emailGenerique} />
                <Field label="Téléphone" value={company.telephoneStandard} />
              </dl>
              {activeSpecialties.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs text-muted">Spécialités</p>
                  <div className="flex flex-wrap gap-1.5">
                    {activeSpecialties.map((s) => (
                      <Badge key={s.key} className="bg-indigo-50 text-brand">
                        {s.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {company.notes && (
                <div className="mt-5">
                  <p className="mb-1 text-xs text-muted">Notes</p>
                  <p className="whitespace-pre-wrap text-sm">{company.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Contacts ({company.contacts.length})</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {company.contacts.length === 0 ? (
                <p className="text-sm text-muted">
                  Aucun contact. Les coordonnées des dirigeants pourront être
                  enrichies plus tard.
                </p>
              ) : (
                company.contacts.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{contactName(c)}</p>
                      <p className="text-xs text-muted">{c.fonction || "—"}</p>
                      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-600">
                        {c.email && <span>{c.email}</span>}
                        {c.telephone && <span>{c.telephone}</span>}
                        {c.linkedinUrl && (
                          <a
                            href={c.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand"
                          >
                            LinkedIn
                          </a>
                        )}
                      </div>
                    </div>
                    <ContactDeleteButton id={c.id} companyId={company.id} />
                  </div>
                ))
              )}
              <AddContactForm companyId={company.id} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Qualification</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="space-y-3">
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-muted">Priorité</dt>
                  <dd>
                    <PrioriteBadge priorite={company.priorite} />
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-muted">Potentiel</dt>
                  <dd>
                    <PotentielBadge potentiel={company.potentiel} />
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-muted">Score ICP</dt>
                  <dd className="text-sm font-medium">
                    {company.icpScore ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-muted">Canal</dt>
                  <dd className="text-sm">{company.canal ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-muted">Dernier contact</dt>
                  <dd className="text-sm">{formatDate(company.dernierContact)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-xs text-muted">Relance prévue</dt>
                  <dd className="text-sm">{formatDate(company.relancePrevue)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activité</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <AddActivityForm companyId={company.id} />
              <div className="space-y-3 border-t border-border pt-4">
                {company.activities.length === 0 ? (
                  <p className="text-sm text-muted">Aucune activité.</p>
                ) : (
                  company.activities.map((a) => (
                    <div key={a.id} className="flex gap-3 text-sm">
                      <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                      <div>
                        <p className="font-medium">{activityLabel(a.type)}</p>
                        {a.note && (
                          <p className="text-slate-600">{a.note}</p>
                        )}
                        <p className="text-xs text-muted">
                          {formatDate(a.date)}
                          {a.user?.name ? ` · ${a.user.name}` : ""}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

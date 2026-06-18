import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { StageBadge } from "@/components/badges";
import { Search, ExternalLink } from "lucide-react";
import {
  AddActivityForm,
  AddContactForm,
  ContactDeleteButton,
  DecisionMakerToggle,
  DeleteCompanyButton,
} from "@/components/company-detail-actions";
import { EnrichButton } from "@/components/enrich-button";
import { CompanyInlineEditor } from "@/components/company-inline-editor";
import {
  companyName,
  contactName,
  personLinkedInSearch,
  companyLinkedInSearch,
  domainFromWebsite,
  suggestedEmail,
} from "@/lib/display";
import { formatDate } from "@/lib/utils";
import { ACTIVITY_TYPES } from "@/lib/constants";

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

  return (
    <div>
      <PageHeader title={companyName(company)} subtitle={company.siret}>
        <StageBadge stage={company.stage} />
        <a
          href={company.siteWeb || companyLinkedInSearch(company)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium hover:bg-slate-50"
        >
          <ExternalLink className="h-4 w-4 text-brand" />
          {company.siteWeb ? "Site web" : "LinkedIn"}
        </a>
        <EnrichButton companyId={company.id} />
        <DeleteCompanyButton id={company.id} />
      </PageHeader>

      <div className="space-y-6 p-6">
        <CompanyInlineEditor company={company} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
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
                company.contacts.map((c) => {
                  const guess = !c.email
                    ? suggestedEmail(c, domainFromWebsite(company.siteWeb))
                    : null;
                  return (
                    <div
                      key={c.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{contactName(c)}</p>
                          <DecisionMakerToggle
                            id={c.id}
                            companyId={company.id}
                            active={Boolean(c.isDecisionMaker)}
                          />
                        </div>
                        <p className="text-xs text-muted">{c.fonction || "—"}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                          {c.email && <span>{c.email}</span>}
                          {!c.email && guess && (
                            <span className="text-slate-400" title="Email probable (à vérifier)">
                              ✉ {guess} <em>(estimé)</em>
                            </span>
                          )}
                          {c.telephone && <span>{c.telephone}</span>}
                          <a
                            href={
                              c.linkedinUrl ||
                              personLinkedInSearch(c, company)
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-brand hover:underline"
                          >
                            <Search className="h-3.5 w-3.5" />
                            {c.linkedinUrl ? "LinkedIn" : "LinkedIn ↗"}
                          </a>
                        </div>
                      </div>
                      <ContactDeleteButton id={c.id} companyId={company.id} />
                    </div>
                  );
                })
              )}
              <AddContactForm companyId={company.id} />
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
                  company.activities.map((a) => {
                    const isEmail = a.type === "EMAIL";
                    const dir =
                      a.direction === "OUTBOUND"
                        ? "↗ Email envoyé"
                        : a.direction === "INBOUND"
                          ? "↘ Email reçu"
                          : null;
                    return (
                      <div key={a.id} className="flex gap-3 text-sm">
                        <div
                          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${isEmail ? "bg-sky-500" : "bg-brand"}`}
                        />
                        <div className="min-w-0">
                          <p className="font-medium">
                            {isEmail ? dir ?? "Email" : activityLabel(a.type)}
                          </p>
                          {isEmail && a.subject && (
                            <p className="truncate text-slate-700">
                              {a.subject}
                            </p>
                          )}
                          {a.note && <p className="text-slate-600">{a.note}</p>}
                          <p className="text-xs text-muted">
                            {formatDate(a.date)}
                            {a.user?.name ? ` · ${a.user.name}` : ""}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

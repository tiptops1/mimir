import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { getGoogleConnection } from "@/lib/integrations";
import { authorNamesByUserId } from "@/lib/authors";
import { EmailComposer } from "@/components/email-composer";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { EnumCell } from "@/components/enum-cell";
import { TaskList, type TaskRow } from "@/components/task-list";
import { NewTaskForm } from "@/components/new-task-form";
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
import { DealsCard, type DealRow } from "@/components/deals-card";
import {
  companyName,
  contactName,
  personLinkedInSearch,
  companyLinkedInSearch,
  domainFromWebsite,
  suggestedEmail,
} from "@/lib/display";
import { formatDate } from "@/lib/utils";
import {
  ACTIVITY_TYPES,
  PIPELINE_STAGES,
  STAGE_LABELS,
  type StageValue,
} from "@/lib/constants";
import { Sparkles } from "lucide-react";

const activityLabel = (t: string) =>
  ACTIVITY_TYPES.find((a) => a.value === t)?.label ?? t;

// Inline-edit options for the stage badge in the header (reuses EnumCell).
const STAGE_OPTIONS = PIPELINE_STAGES.map((s) => ({
  value: s.value,
  label: s.label,
  badge: s.badge,
  dot: s.dot,
}));

const SENTIMENT_STYLE: Record<string, string> = {
  POSITIF: "bg-emerald-100 text-emerald-700",
  NEUTRE: "bg-slate-100 text-slate-600",
  NEGATIF: "bg-rose-100 text-rose-700",
};

function parseActionItems(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const googleConnection = await getGoogleConnection(session.tenantId);
  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      activities: { orderBy: { date: "desc" } },
      tasks: { where: { done: false }, orderBy: { dueDate: "asc" } },
      deals: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  });
  if (!company) notFound();

  const deals: DealRow[] = company.deals.map((d) => ({
    id: d.id,
    title: d.title,
    stage: d.stage,
    product: d.product,
    amount: d.amount,
    status: d.status,
    isPrimary: d.isPrimary,
  }));

  const openTasks: TaskRow[] = company.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    type: t.type,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    source: t.source,
    company: null, // already on this company's page — no need to link back
  }));

  // Activity authors live in the control plane — resolve their names in one batch.
  const authorNames = await authorNamesByUserId(
    company.activities.map((a) => a.userId),
  );

  return (
    <div>
      <PageHeader title={companyName(company)} subtitle={company.siret}>
        <EnumCell
          id={company.id}
          field="stage"
          value={company.stage}
          options={STAGE_OPTIONS}
        />
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tâches ({openTasks.length})</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <TaskList tasks={openTasks} empty="Aucune tâche ouverte." />
              <div className="border-t border-border pt-4">
                <NewTaskForm companyId={company.id} compact />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Affaires ({deals.length})</CardTitle>
            </CardHeader>
            <CardBody>
              <DealsCard companyId={company.id} deals={deals} />
            </CardBody>
          </Card>
        </div>

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
                      className="rounded-lg border border-border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
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
                            <EmailComposer
                              companyId={company.id}
                              contactId={c.id}
                              contactLabel={contactName(c)}
                              defaultTo={c.email || guess || ""}
                              googleConnected={Boolean(googleConnection)}
                              googleEmail={googleConnection?.accountEmail ?? null}
                            />
                          </div>
                        </div>
                        <ContactDeleteButton id={c.id} companyId={company.id} />
                      </div>
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
                            {a.userId && authorNames.get(a.userId)
                              ? ` · ${authorNames.get(a.userId)}`
                              : ""}
                          </p>
                          {a.aiSummary &&
                            (() => {
                              const actions = parseActionItems(a.actionItems);
                              return (
                                <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/50 p-2.5 text-xs">
                                  <div className="mb-1 flex items-center gap-1.5 font-medium text-brand">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Analyse IA
                                    {a.sentiment && (
                                      <span
                                        className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                          SENTIMENT_STYLE[a.sentiment] ??
                                          "bg-slate-100 text-slate-600"
                                        }`}
                                      >
                                        {a.sentiment}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-slate-700">{a.aiSummary}</p>
                                  {a.nextStep && (
                                    <p className="mt-1.5 text-slate-700">
                                      <span className="font-medium">
                                        Prochaine étape :{" "}
                                      </span>
                                      {a.nextStep}
                                    </p>
                                  )}
                                  {actions.length > 0 && (
                                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-600">
                                      {actions.map((item, i) => (
                                        <li key={i}>{item}</li>
                                      ))}
                                    </ul>
                                  )}
                                  {a.suggestedStage && (
                                    <p className="mt-1.5 text-slate-500">
                                      Étape suggérée :{" "}
                                      <span className="font-medium text-slate-700">
                                        {STAGE_LABELS[
                                          a.suggestedStage as StageValue
                                        ] ?? a.suggestedStage}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
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

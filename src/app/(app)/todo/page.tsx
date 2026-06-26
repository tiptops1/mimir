import type { Prisma } from "@prisma/client";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { TaskList, type TaskRow } from "@/components/task-list";
import { TodoFilters } from "@/components/todo-filters";
import { NewTaskForm } from "@/components/new-task-form";
import { companyName } from "@/lib/display";

export default async function TodoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const societe = typeof sp.societe === "string" ? sp.societe : "";
  const type = typeof sp.type === "string" ? sp.type : "";
  const source = typeof sp.source === "string" ? sp.source : "";

  const ci = (v: string) => ({ contains: v, mode: "insensitive" as const });
  // Each active filter is one AND clause, combinable like the other list pages.
  const and: Prisma.TaskWhereInput[] = [{ done: false }];
  if (q) and.push({ title: ci(q) });
  if (societe)
    and.push({ company: { OR: [{ nomSociete: ci(societe) }, { enseigne: ci(societe) }] } });
  if (type === "RELANCE" || type === "APPEL" || type === "EMAIL" || type === "RDV" || type === "AUTRE")
    and.push({ type });
  if (source === "MANUAL" || source === "AI_NEXTSTEP") and.push({ source });

  const hasFilters = Boolean(q || societe || type || source);

  const [tasks, totalOpen, companiesRaw] = await Promise.all([
    prisma.task.findMany({
      where: { AND: and },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        company: {
          select: { id: true, nomSociete: true, enseigne: true, siret: true },
        },
      },
    }),
    prisma.task.count({ where: { done: false } }),
    prisma.company.findMany({
      select: { id: true, nomSociete: true, enseigne: true, siret: true },
      orderBy: { nomSociete: "asc" },
    }),
  ]);

  const companies = companiesRaw.map((c) => ({ id: c.id, name: companyName(c) }));

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const overdue: TaskRow[] = [];
  const dueToday: TaskRow[] = [];
  const upcoming: TaskRow[] = [];
  const undated: TaskRow[] = [];

  for (const t of tasks) {
    const row: TaskRow = {
      id: t.id,
      title: t.title,
      type: t.type,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      source: t.source,
      company: t.company
        ? { id: t.company.id, name: companyName(t.company) }
        : null,
    };
    if (!t.dueDate) undated.push(row);
    else if (t.dueDate < today) overdue.push(row);
    else if (t.dueDate < tomorrow) dueToday.push(row);
    else upcoming.push(row);
  }

  const buckets: { title: string; tasks: TaskRow[]; accent?: string }[] = [
    { title: "En retard", tasks: overdue, accent: "text-rose-600" },
    { title: "Aujourd'hui", tasks: dueToday, accent: "text-amber-600" },
    { title: "À venir", tasks: upcoming },
    { title: "À planifier", tasks: undated },
  ];

  const openCount = tasks.length;

  return (
    <div>
      <PageHeader
        title="À faire"
        subtitle={
          hasFilters
            ? `${openCount} sur ${totalOpen} tâche${totalOpen > 1 ? "s" : ""} ouverte${totalOpen > 1 ? "s" : ""}`
            : `${totalOpen} tâche${totalOpen > 1 ? "s" : ""} ouverte${totalOpen > 1 ? "s" : ""}`
        }
      />

      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <TodoFilters />
          {openCount === 0 ? (
            <EmptyState
              title={hasFilters ? "Aucune tâche ne correspond" : "Rien à faire pour le moment"}
              hint={
                hasFilters
                  ? "Aucune tâche ouverte ne correspond à ces filtres. Réinitialisez pour tout voir."
                  : "Les relances que vous planifiez et les prochaines étapes détectées par l'IA apparaîtront ici."
              }
            />
          ) : (
            buckets
              .filter((b) => b.tasks.length > 0)
              .map((b) => (
                <Card key={b.title}>
                  <CardHeader className="flex items-center justify-between">
                    <CardTitle className={b.accent}>{b.title}</CardTitle>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                      {b.tasks.length}
                    </span>
                  </CardHeader>
                  <CardBody>
                    <TaskList tasks={b.tasks} />
                  </CardBody>
                </Card>
              ))
          )}
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Nouvelle tâche</CardTitle>
            </CardHeader>
            <CardBody>
              <NewTaskForm companies={companies} compact />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

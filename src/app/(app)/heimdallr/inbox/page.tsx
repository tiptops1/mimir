import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, Badge } from "@/components/ui";
import { HeimdallrActionRow } from "@/components/heimdallr-action-row";
import { HeimdallrUndoButton } from "@/components/heimdallr-undo-row";
import { HeimdallrInboxFilters } from "@/components/heimdallr-inbox-filters";
import {
  listPendingActions,
  countPendingActions,
  listUndoTrayActions,
  listAutonomyConfigs,
} from "@/lib/heimdallr/queries";
import { isUndoable } from "@/lib/heimdallr/state-machine";
import { formatDate } from "@/lib/utils";

const MODULE_TONE = {
  heimdallr: "brand",
  mimisbrunnr: "info",
  huginn: "success",
  muninn: "warning",
  nornir: "info",
  bragi: "success",
  forseti: "warning",
  system: "neutral",
} as const;

export default async function HeimdallrInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const category = typeof sp.category === "string" ? sp.category : "";
  const moduleFilter = typeof sp.module === "string" ? sp.module : "";
  const hasFilters = Boolean(q || category || moduleFilter);

  const [pending, totalPending, undoTray, autonomyConfigs] = await Promise.all([
    listPendingActions(prisma, { q, category, module: moduleFilter }),
    countPendingActions(prisma),
    listUndoTrayActions(prisma),
    listAutonomyConfigs(prisma),
  ]);

  const labelFor = (cat: string) =>
    autonomyConfigs.find((c) => c.category === cat)?.label ?? cat;
  const undoWindowFor = (cat: string) =>
    autonomyConfigs.find((c) => c.category === cat)?.undoWindowMinutes ?? 60;

  const now = new Date();
  const undoable = undoTray.filter((a) =>
    isUndoable(a.reversible, a.executedAt, undoWindowFor(a.category), now),
  );
  const breakerTripped = autonomyConfigs.filter(
    (c) => c.level === 1 && c.lastBreakerReason,
  );

  return (
    <div>
      <PageHeader
        title="Boîte à approbations"
        subtitle={
          hasFilters
            ? `${pending.length} sur ${totalPending} proposition${totalPending > 1 ? "s" : ""} en attente`
            : `${totalPending} proposition${totalPending > 1 ? "s" : ""} en attente`
        }
      />
      <div className="p-6">
        <p className="mb-4 max-w-2xl text-sm text-muted">
          Propositions générées par les agents Mimir, en attente de validation humaine.
          Approuvez, modifiez puis approuvez, ou rejetez.
        </p>

        <HeimdallrInboxFilters
          categories={autonomyConfigs.map((c) => ({ value: c.category, label: c.label }))}
        />

        {breakerTripped.length > 0 && (
          <Card className="mb-4 border-warning/40 bg-warning/10 p-4">
            <p className="mb-2 text-sm font-semibold text-foreground">
              ⚠ Disjoncteur déclenché
            </p>
            <ul className="space-y-1 text-sm text-muted">
              {breakerTripped.map((c) => (
                <li key={c.category}>
                  <span className="font-medium text-foreground">{c.label}</span>
                  {" — "}
                  {c.lastBreakerReason}
                  {c.lastBreakerTrippedAt && ` (le ${formatDate(c.lastBreakerTrippedAt)})`}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {pending.length === 0 ? (
          <EmptyState
            title={hasFilters ? "Aucun résultat" : "Rien à valider"}
            hint={
              hasFilters
                ? "Aucune proposition ne correspond à ces filtres. Réinitialisez pour tout voir."
                : "Les nouvelles propositions des agents apparaîtront ici."
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2.5 font-medium">Catégorie</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Proposé le</th>
                    <th className="px-4 py-2.5 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-border align-top last:border-0 hover:bg-surface-2/70"
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{labelFor(a.category)}</p>
                        <Badge tone={MODULE_TONE[a.module as keyof typeof MODULE_TONE] ?? "neutral"} className="mt-1">
                          {a.module}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">{a.type}</td>
                      <td className="px-4 py-3 tnum text-muted">{formatDate(a.proposedAt)}</td>
                      <td className="px-4 py-3">
                        <HeimdallrActionRow
                          id={a.id}
                          payload={a.payload}
                          sources={a.sources}
                          trigger={a.trigger}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {undoable.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-3 text-sm font-semibold text-foreground">
              Actions annulables
            </h2>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 font-medium">Catégorie</th>
                      <th className="px-4 py-2.5 font-medium">Type</th>
                      <th className="px-4 py-2.5 font-medium">Exécuté le</th>
                      <th className="px-4 py-2.5 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {undoable.map((a) => (
                      <tr
                        key={a.id}
                        className="border-b border-border align-top last:border-0 hover:bg-surface-2/70"
                      >
                        <td className="px-4 py-3 font-medium">{labelFor(a.category)}</td>
                        <td className="px-4 py-3 text-muted">{a.type}</td>
                        <td className="px-4 py-3 tnum text-muted">
                          {a.executedAt ? formatDate(a.executedAt) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <HeimdallrUndoButton id={a.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

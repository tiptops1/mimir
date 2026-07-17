import Link from "next/link";
import { getTenantDb } from "@/lib/tenant-context";
import { Badge, Card, EmptyState } from "@/components/ui";
import { UploadForm } from "./upload-form";

// S13b — import runs list + upload. Auth (ADMIN) is enforced by the settings
// layout; the wizard itself lives at /settings/import/[id].

export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  UPLOADED: { label: "Téléversé", tone: "neutral" },
  MAPPED: { label: "Mapping validé", tone: "info" },
  DRY_RUNNING: { label: "Simulation en cours…", tone: "warning" },
  DRY_RUN_DONE: { label: "Simulation terminée", tone: "info" },
  COMMITTING: { label: "Import en cours…", tone: "warning" },
  DONE: { label: "Importé", tone: "success" },
  FAILED: { label: "Échec", tone: "danger" },
};

export default async function ImportRunsPage() {
  const prisma = await getTenantDb();
  const runs = await prisma.importRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      fileName: true,
      status: true,
      rowCount: true,
      stats: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <UploadForm />
      {runs.length === 0 ? (
        <EmptyState
          title="Aucun import pour l'instant"
          hint="Téléversez un export CSV de votre CRM actuel pour démarrer."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-2.5 font-semibold">Fichier</th>
                  <th className="px-4 py-2.5 font-semibold">Statut</th>
                  <th className="px-4 py-2.5 font-semibold">Lignes</th>
                  <th className="px-4 py-2.5 font-semibold">Résultat</th>
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const meta = STATUS_META[run.status] ?? { label: run.status, tone: "neutral" as const };
                  const stats = run.stats as { companiesCreated?: number; skipped?: number; errorRows?: number } | null;
                  return (
                    <tr key={run.id} className="border-b border-border last:border-0 align-top transition-colors hover:bg-surface-2/70">
                      <td className="px-4 py-3">
                        <Link href={`/settings/import/${run.id}`} className="font-medium text-foreground hover:text-brand">
                          {run.fileName}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 tnum">{run.rowCount}</td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {stats
                          ? `${stats.companiesCreated ?? 0} créées · ${stats.skipped ?? 0} ignorées · ${stats.errorRows ?? 0} erreurs`
                          : <span className="text-faint">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted tnum">
                        {run.createdAt.toLocaleDateString("fr-FR")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

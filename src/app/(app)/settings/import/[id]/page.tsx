import Link from "next/link";
import { notFound } from "next/navigation";
import { getTenantDb } from "@/lib/tenant-context";
import { getFieldDefs } from "@/lib/field-config";
import { buildTargetCatalog, type ImportMappingConfig } from "@/lib/import/mapping";
import { parseCsvWithHeader } from "@/lib/import/csv";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { MappingEditor } from "./mapping-editor";
import { RunControls } from "./run-controls";
import { RefreshPoller } from "./refresh-poller";

// S13b — the import wizard. Server-status-driven: ImportRun.status decides
// which step renders; the server actions + Inngest job advance it.

export const dynamic = "force-dynamic";

interface RunStats {
  plannedCreate?: number;
  plannedUpdate?: number;
  plannedSkip?: number;
  companiesCreated?: number;
  companiesUpdated?: number;
  skipped?: number;
  contactsCreated?: number;
  dealsCreated?: number;
  quarantinedRows?: number;
  errorRows?: number;
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" }) {
  return (
    <Card>
      <CardBody className="px-4 py-3">
        <div className={`text-xl font-semibold tracking-tight tnum ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground"}`}>
          {value}
        </div>
        <div className="mt-0.5 text-xs text-muted">{label}</div>
      </CardBody>
    </Card>
  );
}

export default async function ImportRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const prisma = await getTenantDb();
  const run = await prisma.importRun.findUnique({ where: { id } });
  if (!run) notFound();

  const mapping = run.mapping as unknown as
    | (ImportMappingConfig & { columns: Array<ImportMappingConfig["columns"][number] & { confidence?: number }> })
    | null;
  const stats = (run.stats ?? {}) as RunStats;
  const running = run.status === "DRY_RUNNING" || run.status === "COMMITTING";
  const showEditor =
    run.status === "UPLOADED" || (edit === "1" && ["MAPPED", "DRY_RUN_DONE"].includes(run.status));

  // Sample values per column, while the raw CSV still exists (pre-scrub).
  let samples: string[][] = [];
  if (showEditor && run.rawText) {
    try {
      const parsed = parseCsvWithHeader(run.rawText);
      samples = parsed.headers.map((_, col) =>
        parsed.rows.slice(0, 3).map((r) => r[col] ?? "").filter(Boolean),
      );
    } catch {
      samples = [];
    }
  }

  let catalog: ReturnType<typeof buildTargetCatalog> = [];
  if (showEditor || run.status === "MAPPED") {
    const [company, contact, deal] = await Promise.all([
      getFieldDefs("COMPANY"),
      getFieldDefs("CONTACT"),
      getFieldDefs("DEAL"),
    ]);
    catalog = buildTargetCatalog({ COMPANY: company, CONTACT: contact, DEAL: deal });
  }

  const problemRecords = ["DRY_RUN_DONE", "DONE", "FAILED"].includes(run.status)
    ? await prisma.importRecord.findMany({
        where: {
          runId: id,
          OR: [{ status: "ERROR" }, { dedupeHints: { not: null } }],
        },
        orderBy: { rowIndex: "asc" },
        take: 50,
        select: { rowIndex: true, rowKey: true, status: true, errors: true, dedupeHints: true },
      })
    : [];

  return (
    <div className="space-y-6">
      {running && <RefreshPoller />}

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/settings/import" className="text-sm font-medium text-muted hover:text-foreground">
          ← Imports
        </Link>
        <span className="font-medium">{run.fileName}</span>
        <Badge tone={run.status === "DONE" ? "success" : run.status === "FAILED" ? "danger" : running ? "warning" : "info"}>
          {run.status === "UPLOADED" && "Étape 1/3 — Mapping des colonnes"}
          {run.status === "MAPPED" && "Étape 2/3 — Simulation"}
          {run.status === "DRY_RUNNING" && "Simulation en cours…"}
          {run.status === "DRY_RUN_DONE" && "Étape 3/3 — Validation"}
          {run.status === "COMMITTING" && "Import en cours…"}
          {run.status === "DONE" && "Import terminé"}
          {run.status === "FAILED" && "Échec"}
        </Badge>
        <span className="text-xs text-muted tnum">{run.rowCount} lignes</span>
      </div>

      {run.status === "FAILED" && run.error && (
        <div className="rounded-lg border border-danger/30 bg-danger-subtle px-4 py-2.5 text-sm text-danger">
          {run.error}
        </div>
      )}

      {showEditor && mapping && (
        <MappingEditor
          runId={id}
          columns={mapping.columns}
          duplicatePolicy={mapping.options?.duplicatePolicy ?? "skip"}
          samples={samples}
          targets={catalog.map((t) => ({
            value: `${t.entity}::${t.key}::${t.source}`,
            label: t.label,
            entity: t.entity,
          }))}
        />
      )}

      {!showEditor && !running && mapping && (
        <>
          {(run.status === "DRY_RUN_DONE" || run.status === "DONE") && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {run.status === "DRY_RUN_DONE" ? (
                <>
                  <StatTile label="Sociétés à créer" value={stats.plannedCreate ?? 0} />
                  <StatTile label="À mettre à jour" value={stats.plannedUpdate ?? 0} />
                  <StatTile label="Doublons ignorés" value={stats.plannedSkip ?? 0} />
                  <StatTile label="Lignes en erreur" value={stats.errorRows ?? 0} tone={stats.errorRows ? "danger" : undefined} />
                </>
              ) : (
                <>
                  <StatTile label="Sociétés créées" value={stats.companiesCreated ?? 0} />
                  <StatTile label="Mises à jour" value={stats.companiesUpdated ?? 0} />
                  <StatTile label="Doublons ignorés" value={stats.skipped ?? 0} />
                  <StatTile label="Contacts créés" value={stats.contactsCreated ?? 0} />
                  <StatTile label="Champs en quarantaine" value={stats.quarantinedRows ?? 0} tone={stats.quarantinedRows ? "warning" : undefined} />
                  <StatTile label="Lignes en erreur" value={stats.errorRows ?? 0} tone={stats.errorRows ? "danger" : undefined} />
                </>
              )}
            </div>
          )}

          {run.status === "DONE" && (stats.quarantinedRows ?? 0) > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning-subtle px-4 py-2.5 text-sm text-warning">
              {stats.quarantinedRows} ligne(s) contenaient du texte libre signalé par le
              classifieur santé : les fiches ont été importées <strong>sans ces champs</strong> (seule
              une empreinte est conservée en quarantaine — posture d&apos;exclusion D3).
            </div>
          )}

          <RunControls runId={id} status={run.status} />

          {problemRecords.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Lignes à vérifier</CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 font-semibold">Ligne</th>
                      <th className="px-4 py-2.5 font-semibold">Clé</th>
                      <th className="px-4 py-2.5 font-semibold">Détail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problemRecords.map((r) => {
                      const hints = r.dedupeHints as Array<{ kind: string; label: string }> | null;
                      return (
                        <tr key={r.rowIndex} className="border-b border-border last:border-0 align-top">
                          <td className="px-4 py-2.5 tnum">{r.rowIndex + 2}</td>
                          <td className="px-4 py-2.5 text-xs text-muted">{r.rowKey}</td>
                          <td className="px-4 py-2.5 text-xs">
                            {r.status === "ERROR" ? (
                              <span className="text-danger">{r.errors.join(" · ")}</span>
                            ) : (
                              <span className="text-muted">
                                Ressemble à une société existante&nbsp;:{" "}
                                {hints?.map((h) => `${h.label} (${h.kind === "name" ? "nom" : "site web"})`).join(", ")}
                                {" — "}à vérifier dans{" "}
                                <Link href="/settings/duplicates" className="font-medium text-brand hover:underline">
                                  Doublons
                                </Link>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {running && (
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-sm text-muted">
          {run.status === "DRY_RUNNING"
            ? "Simulation en cours — analyse et déduplication des lignes…"
            : "Import en cours — classification santé puis écriture des fiches…"}{" "}
          La page se rafraîchit automatiquement.
        </div>
      )}
    </div>
  );
}

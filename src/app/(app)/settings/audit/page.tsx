import { getTenantDb } from "@/lib/tenant-context";
import { authorNamesByUserId } from "@/lib/authors";
import { Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";

// P2.4 RGPD audit trail viewer (ADMIN via the settings layout): the latest
// destructive / PII-relevant actions, append-only (written by lib/audit.ts).

export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  RGPD_ERASE: "Effacement RGPD",
  RGPD_EXPORT: "Export RGPD",
  CONSENT_SET: "Consentement",
  MERGE_COMPANIES: "Fusion de sociétés",
  MERGE_CONTACTS: "Fusion de contacts",
  DELETE_COMPANY: "Suppression de société",
};

export default async function AuditPage() {
  const prisma = await getTenantDb();
  const entries = await prisma.auditLog.findMany({
    orderBy: { at: "desc" },
    take: 200,
  });
  const names = await authorNamesByUserId(entries.map((e) => e.userId));

  return (
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-muted">
        Journal d&apos;audit — les 200 dernières actions sensibles (effacements,
        exports, fusions, suppressions). Append-only.
      </p>
      {entries.length === 0 ? (
        <EmptyState
          title="Journal vide"
          hint="Les actions sensibles apparaîtront ici au fur et à mesure."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Action</th>
                <th className="px-4 py-2.5 font-semibold">Par</th>
                <th className="px-4 py-2.5 font-semibold">Détails</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted tnum">
                    {formatDate(e.at)}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {ACTION_LABELS[e.action] ?? e.action}
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {(e.userId && names.get(e.userId)) || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{e.details ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

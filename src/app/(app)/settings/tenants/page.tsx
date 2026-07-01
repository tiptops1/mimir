import { verifySession } from "@/lib/dal";
import { isPlatformAdmin } from "@/lib/platform";
import { controlPrisma } from "@/lib/control-db";
import { NewTenantForm } from "@/components/new-tenant-form";
import { Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";

// Phase 4: vendor-only tenant management — list every tenant + provision a new
// one ("Phase 0 on demand"). Hidden unless the session email is listed in
// PLATFORM_ADMIN_EMAILS.

export const dynamic = "force-dynamic";

export default async function TenantsPage() {
  const session = await verifySession();
  if (!isPlatformAdmin(session.email)) {
    return (
      <EmptyState
        title="Réservé à l'administrateur de la plateforme"
        hint="Ajoutez votre email à PLATFORM_ADMIN_EMAILS pour gérer les tenants."
      />
    );
  }

  const tenants = await controlPrisma.tenant.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { memberships: true, integrations: true } },
    },
  });

  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-sm text-muted">
        Chaque tenant = une base isolée sur le cluster, un CRM vide avec la
        config par défaut (étapes + champs), et un admin prêt à se connecter.
      </p>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
              <th className="px-4 py-2.5 font-semibold">Tenant</th>
              <th className="px-4 py-2.5 font-semibold">Slug</th>
              <th className="px-4 py-2.5 font-semibold">Statut</th>
              <th className="px-4 py-2.5 font-semibold">Membres</th>
              <th className="px-4 py-2.5 font-semibold">Intégrations</th>
              <th className="px-4 py-2.5 font-semibold">Créé le</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2.5 font-medium text-foreground">
                  {t.name}
                </td>
                <td className="px-4 py-2.5 text-muted tnum">{t.slug}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.status === "ACTIVE"
                        ? "bg-success-subtle text-success"
                        : "bg-danger-subtle text-danger"
                    }`}
                  >
                    {t.status === "ACTIVE" ? "Actif" : "Suspendu"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted tnum">
                  {t._count.memberships}
                </td>
                <td className="px-4 py-2.5 text-muted tnum">
                  {t._count.integrations}
                </td>
                <td className="px-4 py-2.5 text-muted">
                  {formatDate(t.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <NewTenantForm />
    </div>
  );
}

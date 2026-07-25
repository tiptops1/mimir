import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/ui";
import { getTenantProfile } from "@/lib/tenant-profile";

/**
 * Chronos realm landing page.
 *
 * S26 ships the realm itself — hue, nav entry, module gate — so branding and
 * entitlement are verifiable end to end before any domain model exists. The
 * inventory list, unit detail and margin cockpit land in S27.
 */
export default async function ChronosPage() {
  const profile = await getTenantProfile();

  return (
    <div>
      <PageHeader
        title="Inventaire"
        subtitle={`Achat, restauration et revente — ${profile.brandName}`}
      />
      <div className="p-6">
        <EmptyState
          title="L'inventaire arrive bientôt"
          hint="Les pièces, coûts de restauration et marges nettes seront disponibles ici."
        />
      </div>
    </div>
  );
}

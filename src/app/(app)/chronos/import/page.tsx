import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { EmptyState, LinkButton } from "@/components/ui";
import { SaleImportWizard } from "@/components/chronos/sale-import-wizard";
import { readMarketplaces } from "@/lib/chronos/config";
import { isApiConnector } from "@/lib/chronos/connectors";

/**
 * Chronos → import des ventes (S29).
 *
 * Only marketplaces WITHOUT an API adapter are offered. Importing an eBay CSV
 * by hand would produce a second set of fee lines under a different dedupe-key
 * namespace than the sync's, double-counting the fees on every unit it touched
 * — so the choice is removed rather than warned about.
 */
export default async function ChronosImportPage() {
  await verifySession();
  const prisma = await getTenantDb();

  const marketplaces = (await readMarketplaces(prisma)).filter((m) => !isApiConnector(m.key));

  return (
    <div>
      <PageHeader
        title="Importer des ventes"
        subtitle="Marketplaces sans API — Chrono24, Vinted, LeBonCoin"
      >
        <LinkButton href="/chronos" variant="secondary" size="sm">
          Retour à l&apos;inventaire
        </LinkButton>
      </PageHeader>

      <div className="p-6">
        {marketplaces.length === 0 ? (
          <EmptyState
            title="Aucune marketplace manuelle configurée"
            hint="Toutes les marketplaces de ce tenant se synchronisent par API — rien à importer à la main."
          />
        ) : (
          <SaleImportWizard
            marketplaces={marketplaces.map((m) => ({ key: m.key, label: m.label }))}
          />
        )}
      </div>
    </div>
  );
}

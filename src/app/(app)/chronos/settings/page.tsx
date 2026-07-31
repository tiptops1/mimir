import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardBody, CardHeader, CardTitle, LinkButton } from "@/components/ui";
import { EbayActions } from "@/components/chronos/ebay-card";
import { getEbayConnection } from "@/lib/integrations";
import { ebayConfigured } from "@/lib/ebay-oauth";
import { readMarketplaces } from "@/lib/chronos/config";
import { getConnector, isApiConnector } from "@/lib/chronos/connectors";
import { str } from "@/lib/list-filters";

/**
 * Chronos → Paramètres (S29).
 *
 * Lives under /chronos, NOT in the /settings tab bar: src/components/
 * settings-tabs.tsx is a hardcoded array with no module awareness, so a tab
 * added there would appear for CRM-only tenants. This route inherits the
 * chronos layout's requireModule guard for free.
 *
 * The marketplace table reads capabilities as DATA — it renders "saisie
 * manuelle" for Chrono24 without instantiating a connector, which is the entire
 * reason ConnectorCapabilities is a plain object rather than Freyja's
 * method-presence check.
 */
export default async function ChronosSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const sp = await searchParams;
  const flag = str(sp, "ebay");

  const [connection, marketplaces] = await Promise.all([
    getEbayConnection(session.tenantId),
    readMarketplaces(prisma),
  ]);

  const pendingCount = await prisma.marketplaceOrder.count({ where: { status: "PENDING" } });
  const configured = ebayConfigured();

  return (
    <div>
      <PageHeader
        title="Paramètres Chronos"
        subtitle="Connexions marketplace et synchronisation des ventes"
      >
        <LinkButton href="/chronos" variant="secondary" size="sm">
          Retour à l&apos;inventaire
        </LinkButton>
      </PageHeader>

      <div className="space-y-4 p-6">
        {flag === "connected" ? (
          <Notice tone="success" icon={<CheckCircle2 className="h-4 w-4" />}>
            Compte eBay connecté. La première synchronisation peut être lancée ci-dessous.
          </Notice>
        ) : null}
        {flag === "error" ? (
          <Notice tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
            La connexion eBay a échoué. Vérifiez que l&apos;URL de redirection enregistrée sous le
            RuName correspond bien à cette application, puis réessayez.
          </Notice>
        ) : null}
        {flag === "unconfigured" ? (
          <Notice tone="warning" icon={<AlertTriangle className="h-4 w-4" />}>
            L&apos;intégration eBay n&apos;est pas configurée sur cet environnement
            (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_RUNAME).
          </Notice>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>eBay</CardTitle>
            {connection ? (
              <Badge tone="success">Connecté</Badge>
            ) : (
              <Badge tone="neutral">Non connecté</Badge>
            )}
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-muted">
              Récupère vos propres commandes et surtout le <strong>détail réel des frais</strong>{" "}
              eBay, imputé ligne à ligne sur chaque montre. C&apos;est ce qui rend la marge nette
              exacte au centime plutôt qu&apos;estimée.
            </p>

            {connection ? (
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <Field label="Compte" value={connection.accountLabel || "eBay"} />
                <Field
                  label="Connecté le"
                  value={connection.connectedAt.toLocaleDateString("fr-FR")}
                />
                <Field
                  label="Dernière synchro"
                  value={
                    connection.lastSyncedAt
                      ? connection.lastSyncedAt.toLocaleString("fr-FR")
                      : "Jamais"
                  }
                />
              </dl>
            ) : null}

            {configured || connection ? (
              <EbayActions connected={Boolean(connection)} />
            ) : (
              <p className="text-xs text-faint">
                Configurez les variables d&apos;environnement eBay avant de connecter un compte.
              </p>
            )}

            <p className="flex items-start gap-2 text-xs text-faint">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Accès en lecture seule (commandes, finances, inventaire). Chronos ne met jamais
                d&apos;annonce en ligne et ne vend rien à votre place.
              </span>
            </p>
          </CardBody>
        </Card>

        {pendingCount > 0 ? (
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-foreground">
                <span className="tnum font-semibold">{pendingCount}</span> commande(s) en attente de
                rapprochement — aucune ligne de frais ne leur est imputée tant qu&apos;une unité
                n&apos;est pas désignée.
              </p>
              <LinkButton href="/chronos/reconciliation" size="sm">
                Rapprocher
              </LinkButton>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Marketplaces</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint">
                    <th className="px-4 py-2.5 text-left font-medium">Marketplace</th>
                    <th className="px-4 py-2.5 text-left font-medium">Synchronisation</th>
                    <th className="px-4 py-2.5 text-left font-medium">Frais réels</th>
                  </tr>
                </thead>
                <tbody>
                  {marketplaces.map((m) => {
                    const api = m.sync === "api" && isApiConnector(m.key);
                    const caps = api ? getConnector(m.key).capabilities : null;
                    return (
                      <tr key={m.key} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-medium text-foreground">{m.label}</td>
                        <td className="px-4 py-3">
                          {api ? (
                            <Badge tone="info">Synchronisation API</Badge>
                          ) : (
                            <Badge tone="neutral">Saisie manuelle</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {caps?.ownOrders ? (
                            "Détail des frais eBay"
                          ) : (
                            <Link href="/chronos/import" className="text-brand hover:underline">
                              Import CSV des ventes
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: "success" | "danger" | "warning";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneClass = {
    success: "border-success/30 bg-success-subtle text-success",
    danger: "border-danger/30 bg-danger-subtle text-danger",
    warning: "border-warning/30 bg-warning-subtle text-warning",
  }[tone];
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${toneClass}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

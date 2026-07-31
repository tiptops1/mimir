import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardBody, EmptyState, LinkButton } from "@/components/ui";
import { ReconcileControls, type UnitOption } from "@/components/chronos/reconcile-row";
import { UNSOLD_WHERE } from "@/lib/chronos/inventory";
import { formatCents } from "@/lib/display";
import { str } from "@/lib/list-filters";

/**
 * Chronos → rapprochement (S29).
 *
 * The queue of marketplace orders the sync could not attribute to a unit. It
 * exists because an eBay line carries a SKU only if the seller set a listing
 * custom label — matching is therefore best-effort, and a WRONG match corrupts
 * two units' margins at once while being far harder to notice than a queue
 * item. So: nothing is written until a human designates the unit.
 */

const REASON_LABEL: Record<string, string> = {
  no_sku: "Aucun SKU sur la ligne",
  multi_quantity: "Quantité > 1",
};

interface OrderLine {
  sku?: string | null;
  title?: string;
  quantity?: number;
  grossCents?: number;
  fees?: Array<{ kind?: string; label?: string; amountCents?: number }>;
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();
  const sp = await searchParams;
  const showIgnored = str(sp, "statut") === "ignorees";

  const [orders, units] = await Promise.all([
    prisma.marketplaceOrder.findMany({
      where: { status: showIgnored ? "IGNORED" : "PENDING" },
      orderBy: { soldAt: "desc" },
      take: 100,
    }),
    // Only unsold stock can be the subject of a sale. UNSOLD_WHERE carries the
    // Mongo isSet trap correctly — "not yet sold" is { soldAt: { isSet: false } },
    // not { soldAt: null }.
    prisma.inventoryUnit.findMany({
      where: UNSOLD_WHERE,
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, serial: true, ref: { select: { brand: true, reference: true } } },
      take: 500,
    }),
  ]);

  const unitOptions: UnitOption[] = units.map((u) => ({
    id: u.id,
    sku: u.sku,
    label: `${u.sku} — ${u.ref.brand} ${u.ref.reference}${u.serial ? ` (${u.serial})` : ""}`,
  }));

  return (
    <div>
      <PageHeader
        title="Rapprochement des ventes"
        subtitle="Commandes marketplace sans unité identifiée — aucune n'est imputée automatiquement"
      >
        <LinkButton
          href={showIgnored ? "/chronos/reconciliation" : "/chronos/reconciliation?statut=ignorees"}
          variant="secondary"
          size="sm"
        >
          {showIgnored ? "Voir les commandes en attente" : "Voir les commandes ignorées"}
        </LinkButton>
        <LinkButton href="/chronos/settings" variant="ghost" size="sm">
          Paramètres
        </LinkButton>
      </PageHeader>

      <div className="space-y-4 p-6">
        {orders.length === 0 ? (
          <EmptyState
            title={showIgnored ? "Aucune commande ignorée" : "Rien à rapprocher"}
            hint={
              showIgnored
                ? "Les commandes que vous mettez de côté apparaissent ici."
                : "Toutes les commandes synchronisées ont été rattachées à une unité."
            }
          />
        ) : (
          orders.map((order) => {
            const lines = (Array.isArray(order.lines) ? order.lines : []) as OrderLine[];
            const feeCount = lines.reduce((n, l) => n + (l.fees?.length ?? 0), 0);
            return (
              <Card key={order.id}>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{order.provider}</span>
                        <span className="tnum text-sm text-muted">{order.externalId}</span>
                        {order.unmatchedReason ? (
                          <Badge tone="warning">
                            {REASON_LABEL[order.unmatchedReason] ?? order.unmatchedReason}
                          </Badge>
                        ) : null}
                        {showIgnored ? <Badge tone="neutral">Ignorée</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        Vendue le{" "}
                        <span className="tnum">{order.soldAt.toLocaleDateString("fr-FR")}</span> ·{" "}
                        <span className="tnum">{formatCents(order.grossCents)}</span> ·{" "}
                        {feeCount} ligne(s) de frais en attente d&apos;imputation
                      </p>
                    </div>
                    {!showIgnored ? (
                      <ReconcileControls orderId={order.id} units={unitOptions} />
                    ) : null}
                  </div>

                  {lines.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint">
                            <th className="px-4 py-2.5 text-left font-medium">Article</th>
                            <th className="px-4 py-2.5 text-left font-medium">SKU</th>
                            <th className="px-4 py-2.5 text-right font-medium">Qté</th>
                            <th className="px-4 py-2.5 text-right font-medium">Montant</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lines.map((line, i) => (
                            <tr key={i} className="border-b border-border last:border-0">
                              <td className="px-4 py-2.5 text-foreground">{line.title || "—"}</td>
                              <td className="tnum px-4 py-2.5 text-muted">{line.sku || "—"}</td>
                              <td className="tnum px-4 py-2.5 text-right text-muted">
                                {line.quantity ?? 1}
                              </td>
                              <td className="tnum px-4 py-2.5 text-right text-foreground">
                                {formatCents(line.grossCents ?? 0)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

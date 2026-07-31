import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState } from "@/components/ui";
import { getMarketOverview, type RefBandView } from "@/lib/chronos/comps-store";
import { confidenceFor, DEFAULT_COMP_WINDOW_DAYS, type BandConfidence } from "@/lib/chronos/comps";
import { formatCents } from "@/lib/display";
import { cn } from "@/lib/utils";

/**
 * Chronos → Cote du marché (Argus, S30).
 *
 * Read-only, and deliberately so: the page renders what the last sweep
 * concluded and never recomputes on load (unlike /forseti and /thor, whose
 * inputs are cheap CRM reads — a band recompute here would re-read every price
 * point of every reference on an M0 cluster). The sweep's date is therefore on
 * screen, so a stale band reads as stale rather than as fresh truth.
 *
 * THE PRESENTATION RULE THIS PAGE EXISTS TO HOLD: sold prices and asking prices
 * are shown in separate columns, separately labelled, and never combined into a
 * single "market price". An ask is what a seller hopes for and a large share
 * never sell; blending the two would flatter every valuation on the page. The
 * data model enforces it (PricePoint.kind) and computeBand() throws on a mixed
 * array — this is the third layer, the one the operator actually sees.
 */

const CONFIDENCE_LABEL: Record<BandConfidence, string> = {
  NONE: "aucune donnée",
  LOW: "peu fiable",
  MEDIUM: "correcte",
  HIGH: "solide",
};

const CONFIDENCE_TONE: Record<BandConfidence, "neutral" | "warning" | "info" | "success"> = {
  NONE: "neutral",
  LOW: "warning",
  MEDIUM: "info",
  HIGH: "success",
};

export default async function ArgusPage() {
  await verifySession();
  const prisma = await getTenantDb();
  const overview = await getMarketOverview(prisma);

  const withoutAliases = overview.rows.filter((r) => r.aliasCount === 0).length;

  return (
    <div>
      <PageHeader
        title="Cote du marché"
        subtitle={`Bandes de prix par référence, calculées sur ${DEFAULT_COMP_WINDOW_DAYS} jours glissants`}
        titleTransitionName="argus-title"
      />

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi value={String(overview.refCount)} label="Références suivies" hint="au catalogue" />
          <Kpi
            value={String(overview.soldPointCount)}
            label="Ventes réalisées"
            hint="vos propres ventes — la référence"
          />
          <Kpi
            value={String(overview.askPointCount)}
            label="Prix demandés"
            hint="annonces observées, jamais des ventes"
          />
          <Kpi
            value={String(overview.driftCount)}
            label="Alertes de dérive"
            hint="médiane déplacée depuis le dernier relevé"
            tone={overview.driftCount > 0 ? "warning" : undefined}
          />
        </div>

        <Card>
          <CardBody className="flex items-start gap-2 text-xs text-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Les <strong>ventes réalisées</strong> sont vos propres ventes : un acheteur a
              réellement payé ce prix. Les <strong>prix demandés</strong> sont des annonces en
              cours — ce qu&apos;un vendeur espère obtenir, et une large part ne se vend jamais.
              Les deux ne sont jamais mélangés dans un même chiffre.
              {overview.lastComputedAt ? (
                <>
                  {" "}
                  Dernier relevé&nbsp;: {overview.lastComputedAt.toLocaleString("fr-FR")}.
                </>
              ) : (
                <> Aucun relevé effectué pour l&apos;instant.</>
              )}
            </span>
          </CardBody>
        </Card>

        {withoutAliases > 0 ? (
          <Card className="border-warning/30">
            <CardBody className="text-sm text-muted">
              <span className="tnum font-semibold text-foreground">{withoutAliases}</span>{" "}
              référence(s) n&apos;ont aucun alias déclaré. Sans alias, aucune annonce ne peut leur
              être rattachée sans risque de confusion avec un autre modèle — leur bande « prix
              demandés » restera vide tant qu&apos;un alias n&apos;est pas renseigné.
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Par référence</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            {overview.rows.length === 0 ? (
              <EmptyState
                title="Aucune référence"
                hint="Ajoutez des références au catalogue pour suivre leur cote."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint">
                      <th className="px-4 py-2.5 text-left font-medium">Référence</th>
                      <th className="px-4 py-2.5 text-right font-medium">En stock</th>
                      <th className="px-4 py-2.5 text-left font-medium">
                        Ventes réalisées (p25 · médiane · p75)
                      </th>
                      <th className="px-4 py-2.5 text-left font-medium">Fiabilité</th>
                      <th className="px-4 py-2.5 text-left font-medium">Prix demandés</th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Dérive (ventes)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.rows.map((row) => (
                      <tr key={row.refId} className="border-b border-border last:border-0">
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            {row.brand} {row.reference}
                          </div>
                          {row.model ? (
                            <div className="text-xs text-faint">{row.model}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tnum text-muted">
                          {row.unitsInStock}
                        </td>
                        <td className="px-4 py-3">
                          <BandCell band={row.sold} />
                        </td>
                        <td className="px-4 py-3">
                          {row.sold ? (
                            <Badge tone={CONFIDENCE_TONE[confidenceFor(row.sold.sampleSize)]}>
                              {CONFIDENCE_LABEL[confidenceFor(row.sold.sampleSize)]} ·{" "}
                              {row.sold.sampleSize}
                            </Badge>
                          ) : (
                            <span className="text-xs text-faint">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <BandCell band={row.ask} muted />
                        </td>
                        <td className="px-4 py-3 text-right">
                          {/* SOLD only. Falling back to the ask band here would
                              put an ask-derived number in an unlabelled column,
                              which is the one thing this page must not do. */}
                          <DriftCell band={row.sold} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/**
 * A band, or an explicit "pas de comparable" — never a 0 €. An absent band and
 * a band of zero are different facts and must not look alike.
 */
function BandCell({ band, muted }: { band: RefBandView | null; muted?: boolean }) {
  if (!band) return <span className="text-xs text-faint">pas de comparable</span>;
  return (
    <div className={cn("tnum", muted ? "text-muted" : "text-foreground")}>
      <span className="text-xs text-faint">{formatCents(band.p25Cents)}</span>
      <span className="mx-1.5 font-semibold">{formatCents(band.medianCents)}</span>
      <span className="text-xs text-faint">{formatCents(band.p75Cents)}</span>
    </div>
  );
}

function DriftCell({ band }: { band: RefBandView | null }) {
  if (!band || band.driftPct === null) return <span className="text-xs text-faint">—</span>;
  const up = band.driftPct > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tnum text-sm",
        // Only a band that CROSSED the threshold on a big enough sample gets
        // colour. A 2% wobble is not news and must not read like an alert.
        band.drifted ? (up ? "text-success" : "text-danger") : "text-muted",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {band.driftPct > 0 ? "+" : ""}
      {band.driftPct.toFixed(1)} %
    </span>
  );
}

function Kpi({
  value,
  label,
  hint,
  tone,
}: {
  value: string;
  label: string;
  hint: string;
  tone?: "warning";
}) {
  return (
    <Card>
      <CardBody>
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight tnum",
            tone === "warning" && "text-warning",
          )}
        >
          {value}
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-faint">{hint}</p>
      </CardBody>
    </Card>
  );
}

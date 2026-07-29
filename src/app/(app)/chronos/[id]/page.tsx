import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { EnumCell, type EnumOption } from "@/components/enum-cell";
import { CustomFieldsSection } from "@/components/custom-fields-section";
import { setUnitEnum } from "@/app/actions/chronos";
import { setUnitCustomField } from "@/app/actions/custom-fields";
import { getFieldDefs, readCustomFields } from "@/lib/field-config";
import { getUnitStageDefs } from "@/lib/chronos/unit-stage-config";
import { loadVatConfig } from "@/lib/chronos/inventory";
import { readMarketplaces } from "@/lib/chronos/config";
import { computeUnitMargin, type VatScheme } from "@/lib/chronos/margin";
import { MarginWaterfall } from "@/components/chronos/margin-waterfall";
import {
  UnitCostsCard,
  type CostLineRow,
} from "@/components/chronos/unit-costs-card";
import {
  UnitInlineEditor,
  type UnitEditorValues,
} from "@/components/chronos/unit-inline-editor";
import { formatCents } from "@/lib/display";
import { formatDate } from "@/lib/utils";

// Chronos unit detail — the margin waterfall, the cost ledger behind it, and
// the editable record. Structured like companies/[id]/page.tsx: all loading
// inline, plain DTOs handed to client components.

const VAT_SCHEMES = ["MARGIN", "STANDARD", "EXEMPT"];

/** Date column → the yyyy-mm-dd an <input type="date"> expects. */
const dateInput = (d: Date | null): string =>
  d ? d.toISOString().slice(0, 10) : "";

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await verifySession();
  const prisma = await getTenantDb();
  const { id } = await params;

  const unit = await prisma.inventoryUnit.findUnique({
    where: { id },
    include: {
      ref: true,
      costs: { orderBy: { incurredAt: "asc" } },
      partConsumptions: { include: { lot: true }, orderBy: { consumedAt: "asc" } },
    },
  });
  if (!unit) notFound();

  const [stages, vat, marketplaces, allFieldDefs] = await Promise.all([
    getUnitStageDefs(),
    loadVatConfig(prisma),
    readMarketplaces(prisma),
    getFieldDefs("INVENTORY_UNIT"),
  ]);

  // Per-unit override wins over the tenant default, exactly as in inventory.ts.
  const effectiveScheme = VAT_SCHEMES.includes(unit.vatScheme ?? "")
    ? (unit.vatScheme as VatScheme)
    : vat.vatScheme;

  const margin = computeUnitMargin({
    unitId: unit.id,
    sku: unit.sku,
    acquiredAt: unit.acquiredAt,
    soldAt: unit.soldAt,
    salePriceCents: unit.salePriceCents,
    saleFxRate: unit.saleFxRate,
    vatScheme: effectiveScheme,
    vatRatePct: vat.vatRatePct,
    costs: unit.costs,
  });

  const nativeDefs = allFieldDefs.filter((d) => d.source === "NATIVE");
  const customDefs = allFieldDefs.filter((d) => d.source === "CUSTOM");

  const stageOptions: EnumOption[] = stages.map((s) => ({
    value: s.value,
    label: s.label,
    badge: s.badge,
    dot: s.dot,
  }));

  const values: UnitEditorValues = {
    id: unit.id,
    listedAt: dateInput(unit.listedAt),
    soldAt: dateInput(unit.soldAt),
    soldOn: unit.soldOn ?? "",
    salePrice:
      unit.salePriceCents == null
        ? ""
        : (unit.salePriceCents / 100).toFixed(2).replace(".", ","),
    saleCurrency: unit.saleCurrency ?? "",
    saleFxRate: unit.saleFxRate == null ? "" : String(unit.saleFxRate),
    vatScheme: unit.vatScheme ?? "",
    notes: unit.notes ?? "",
  };

  const costLines: CostLineRow[] = unit.costs.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    amountCents: c.amountCents,
    currency: c.currency,
    fxRate: c.fxRate,
    baseAmountCents: c.baseAmountCents,
    incurredAt: c.incurredAt,
    source: c.source,
  }));

  const refLabel = [unit.ref.brand, unit.ref.reference, unit.ref.model, unit.ref.variant]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <PageHeader
        title={unit.sku}
        subtitle={refLabel}
        titleTransitionName={`unit-${unit.id}`}
      >
        <EnumCell
          id={unit.id}
          field="status"
          value={unit.status}
          options={stageOptions}
          action={setUnitEnum}
        />
      </PageHeader>

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Marge réelle</CardTitle>
            </CardHeader>
            <CardBody>
              <MarginWaterfall margin={margin} vatScheme={effectiveScheme} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pièces consommées</CardTitle>
            </CardHeader>
            <CardBody>
              {unit.partConsumptions.length === 0 ? (
                <p className="text-sm text-muted">
                  Aucun lot de pièces imputé sur cette pièce.
                </p>
              ) : (
                <ul className="space-y-3">
                  {unit.partConsumptions.map((pc) => (
                    <li
                      key={pc.id}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <span className="block truncate text-sm text-foreground">
                          {pc.lot.label}
                        </span>
                        <span className="block text-xs text-faint tnum">
                          ×{pc.quantity} · {formatDate(pc.consumedAt)}
                        </span>
                      </div>
                      <span className="shrink-0 text-sm tnum text-muted">
                        {formatCents(pc.unitCostCents * pc.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <UnitInlineEditor
          unit={unit as unknown as Record<string, unknown>}
          values={values}
          nativeDefs={nativeDefs}
          marketplaces={marketplaces}
          tenantVatScheme={vat.vatScheme}
        />

        <Card>
          <CardHeader>
            <CardTitle>Lignes de coût ({costLines.length})</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <div className="p-5">
              <UnitCostsCard unitId={unit.id} lines={costLines} />
            </div>
          </CardBody>
        </Card>

        {customDefs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Champs personnalisés</CardTitle>
            </CardHeader>
            <CardBody>
              <CustomFieldsSection
                recordId={unit.id}
                defs={customDefs}
                values={readCustomFields(unit.customFields)}
                save={setUnitCustomField}
              />
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

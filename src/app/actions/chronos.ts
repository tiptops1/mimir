"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { getUnitStageDefs } from "@/lib/chronos/unit-stage-config";
import { addUnitCost } from "@/lib/chronos/costs";
import { COST_KINDS, toCents } from "@/lib/chronos/margin";
import type { FormResult } from "@/app/actions/companies";

/**
 * Chronos (S27b) — write side of the inventory vertical.
 *
 * Deliberately NOT through the Heimdallr ledger: these are an operator's direct
 * actions on their own stock, not an agent proposing something. Same posture
 * decisions.md recorded for S13b's admin-commanded imports.
 *
 * Every cost line goes through addUnitCost (src/lib/chronos/costs.ts) — nothing
 * here calls prisma.unitCost.create, which would bypass the (unitId, dedupeKey)
 * re-sync guard.
 */

const VAT_SCHEMES = ["MARGIN", "STANDARD", "EXEMPT"];

function revalidateUnit(id: string) {
  revalidatePath("/chronos");
  revalidatePath(`/chronos/${id}`);
}

const text = (fd: FormData, key: string): string =>
  String(fd.get(key) ?? "").trim();

/** Empty string clears the column; anything unparseable is treated as absent. */
function dateOrNull(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Inline-edit a unit's status from the table or the detail header.
 *
 * Signature matches EnumCell's entity-agnostic `action` prop. Values are
 * validated against the INVENTORY_UNIT stage config, not a code enum, and invalid
 * input returns silently — same contract as setCompanyEnum.
 */
export async function setUnitEnum(
  id: string,
  field: string,
  value: string,
): Promise<void> {
  await verifySession();
  if (field !== "status") return;
  const prisma = await getTenantDb();
  const keys = (await getUnitStageDefs()).map((s) => s.value);
  if (!keys.includes(value)) return;

  await prisma.inventoryUnit.update({ where: { id }, data: { status: value } });
  revalidateUnit(id);
}

/** Identity, acquisition and sale, from the unit detail's inline editor. */
export async function updateUnit(
  id: string,
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();

  const sku = text(formData, "sku");
  if (!sku) return { error: "Le SKU est obligatoire." };

  // Money arrives as typed euros ("1 234,56"); toCents is the single parser.
  const salePriceRaw = text(formData, "salePrice");
  let salePriceCents: number | null = null;
  if (salePriceRaw) {
    salePriceCents = toCents(salePriceRaw);
    if (salePriceCents === null) {
      return { error: "Prix de vente invalide." };
    }
  }

  const fxRaw = text(formData, "saleFxRate").replace(",", ".");
  let saleFxRate: number | null = null;
  if (fxRaw) {
    const parsed = Number.parseFloat(fxRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { error: "Taux de change invalide." };
    }
    saleFxRate = parsed;
  }

  const vatScheme = text(formData, "vatScheme");
  if (vatScheme && !VAT_SCHEMES.includes(vatScheme)) {
    return { error: "Régime de TVA inconnu." };
  }

  try {
    await prisma.inventoryUnit.update({
      where: { id },
      data: {
        sku,
        serial: text(formData, "serial") || null,
        condition: text(formData, "condition"),
        acquiredAt: dateOrNull(text(formData, "acquiredAt")),
        acquiredVia: text(formData, "acquiredVia") || null,
        supplier: text(formData, "supplier") || null,
        listedAt: dateOrNull(text(formData, "listedAt")),
        soldAt: dateOrNull(text(formData, "soldAt")),
        soldOn: text(formData, "soldOn") || null,
        salePriceCents,
        saleCurrency: text(formData, "saleCurrency") || null,
        saleFxRate,
        // Null = fall back to the tenant's ChronosConfig scheme.
        vatScheme: vatScheme || null,
        notes: text(formData, "notes") || null,
      },
    });
  } catch {
    // The only realistic failure is the sku @unique.
    return { error: "Ce SKU est déjà utilisé par une autre pièce." };
  }

  revalidateUnit(id);
  return { ok: true };
}

/**
 * Create a unit, resolving (or creating) its catalog entry, and book the
 * purchase price as the ACQUISITION cost line in the same pass — a unit with no
 * acquisition cost would show a fictitious 100 % margin.
 */
export async function createUnit(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();

  const sku = text(formData, "sku");
  const brand = text(formData, "brand");
  const reference = text(formData, "reference");
  if (!sku) return { error: "Le SKU est obligatoire." };
  if (!brand || !reference) {
    return { error: "La marque et la référence sont obligatoires." };
  }

  const priceRaw = text(formData, "acquisitionPrice");
  let acquisitionCents: number | null = null;
  if (priceRaw) {
    acquisitionCents = toCents(priceRaw);
    if (acquisitionCents === null || acquisitionCents < 0) {
      return { error: "Prix d'achat invalide." };
    }
  }

  const existingSku = await prisma.inventoryUnit.findUnique({
    where: { sku },
    select: { id: true },
  });
  if (existingSku) return { error: "Ce SKU existe déjà." };

  // "" rather than null on variant/model — the (brand, reference, variant)
  // unique treats an absent Mongo field as null, which would collapse every
  // variant-less reference into one row.
  const variant = text(formData, "variant");
  const ref = await prisma.productRef.upsert({
    where: { brand_reference_variant: { brand, reference, variant } },
    update: {},
    create: {
      brand,
      reference,
      variant,
      model: text(formData, "model"),
      aliases: [],
    },
  });

  const acquiredAt = dateOrNull(text(formData, "acquiredAt")) ?? new Date();
  const unit = await prisma.inventoryUnit.create({
    data: {
      refId: ref.id,
      sku,
      serial: text(formData, "serial") || null,
      condition: text(formData, "condition"),
      status: "ACQUIRED",
      acquiredAt,
      acquiredVia: text(formData, "acquiredVia") || null,
      supplier: text(formData, "supplier") || null,
    },
  });

  if (acquisitionCents !== null) {
    await addUnitCost(prisma, {
      unitId: unit.id,
      kind: "ACQUISITION",
      label: "Prix d'achat",
      amountCents: acquisitionCents,
      incurredAt: acquiredAt,
      // Stable key, so re-entering the purchase price corrects the line
      // instead of booking the cost twice.
      dedupeKey: "acquisition",
    });
  }

  revalidatePath("/chronos");
  redirect(`/chronos/${unit.id}`);
}

/** Add one cost line to a unit, from the detail page's inline form. */
export async function addUnitCostLine(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();

  const unitId = text(formData, "unitId");
  const kind = text(formData, "kind");
  if (!unitId) return { error: "Pièce introuvable." };
  if (!COST_KINDS.includes(kind)) return { error: "Type de coût inconnu." };

  const amountCents = toCents(text(formData, "amount"));
  if (amountCents === null || amountCents < 0) {
    return { error: "Montant invalide." };
  }

  const fxRaw = text(formData, "fxRate").replace(",", ".");
  const fxRate = fxRaw ? Number.parseFloat(fxRaw) : 1;
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return { error: "Taux de change invalide." };
  }

  await addUnitCost(prisma, {
    unitId,
    kind,
    label: text(formData, "label"),
    amountCents,
    currency: text(formData, "currency") || "EUR",
    fxRate,
    incurredAt: dateOrNull(text(formData, "incurredAt")) ?? new Date(),
    source: "MANUAL",
  });

  revalidateUnit(unitId);
  return { ok: true };
}

/**
 * Delete a cost line. MANUAL lines only: a marketplace-synced fee or a part-lot
 * draw-down is someone else's record of truth, and hand-deleting it would put
 * the unit permanently out of step with the statement it reconciles against.
 */
export async function deleteUnitCostLine(id: string): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const line = await prisma.unitCost.findUnique({
    where: { id },
    select: { unitId: true, source: true },
  });
  if (!line || line.source !== "MANUAL") return;

  await prisma.unitCost.delete({ where: { id } });
  revalidateUnit(line.unitId);
}

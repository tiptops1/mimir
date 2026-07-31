"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { DEFAULT_STAGE_ENTITY, type StageEntity } from "@/lib/stage-config";

// Self-serve stage editor — writes to the StageDefinition config store that
// stage-config.ts (reader) reads. ADMIN-only. `key` is immutable once created:
// it's the value stored on Company.stage / Deal.stage / InventoryUnit.status,
// so renaming an in-use key would orphan existing records — sidestepped
// entirely by never allowing a key edit, rather than building rename-migration.
//
// ENTITY-AWARE since S31. Every action carries the entity it operates on, and
// the uniqueness check is scoped to it: COMPANY and INVENTORY_UNIT may each
// hold a "READY" key without colliding, which is precisely what the old global
// `key @unique` made impossible.

export interface StageConfigResult {
  error?: string;
  ok?: boolean;
}

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

const VALID_ENTITIES: StageEntity[] = ["COMPANY", "INVENTORY_UNIT"];

/** Never trust an entity off a form — an unknown value would create an orphan scope. */
function parseEntity(value: FormDataEntryValue | string | null): StageEntity {
  const raw = String(value ?? "").trim().toUpperCase();
  return (VALID_ENTITIES as string[]).includes(raw)
    ? (raw as StageEntity)
    : DEFAULT_STAGE_ENTITY;
}

function revalidateAll() {
  revalidatePath("/pipeline");
  revalidatePath("/companies");
  revalidatePath("/analytics");
  revalidatePath("/chronos");
  revalidatePath("/settings/stages");
}

export async function createStageDef(
  _prev: StageConfigResult | undefined,
  formData: FormData,
): Promise<StageConfigResult> {
  await requireRole(["ADMIN"]);
  const key = String(formData.get("key") ?? "").trim().toUpperCase();
  const label = String(formData.get("label") ?? "").trim();
  const accentClass = String(formData.get("accentClass") ?? "").trim();
  const badgeClass = String(formData.get("badgeClass") ?? "").trim();
  const dotClass = String(formData.get("dotClass") ?? "").trim();
  const isWon = formData.get("isWon") === "on";
  const isLost = formData.get("isLost") === "on";
  const entity = parseEntity(formData.get("entity"));

  if (!key || !KEY_RE.test(key)) {
    return {
      error: "Clé invalide (majuscules/chiffres/underscore, doit commencer par une lettre).",
    };
  }
  if (!label) {
    return { error: "Le libellé est requis." };
  }

  const prisma = await getTenantDb();
  const existing = await prisma.stageDefinition.findUnique({
    where: { entity_key: { entity, key } },
  });
  if (existing) {
    return { error: "Cette clé d'étape existe déjà." };
  }

  // Scoped to the entity, or a new workshop status would be ordered after the
  // last pipeline stage and land at the bottom of a list it isn't even in.
  const maxOrder = await prisma.stageDefinition.findFirst({
    where: { entity },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  await prisma.stageDefinition.create({
    data: {
      entity,
      key,
      label,
      accentClass,
      badgeClass,
      dotClass,
      isWon,
      isLost,
      order: (maxOrder?.order ?? 0) + 1,
    },
  });

  revalidateAll();
  return { ok: true };
}

export async function updateStageDef(
  id: string,
  _prev: StageConfigResult | undefined,
  formData: FormData,
): Promise<StageConfigResult> {
  await requireRole(["ADMIN"]);
  const label = String(formData.get("label") ?? "").trim();
  const accentClass = String(formData.get("accentClass") ?? "").trim();
  const badgeClass = String(formData.get("badgeClass") ?? "").trim();
  const dotClass = String(formData.get("dotClass") ?? "").trim();
  const isWon = formData.get("isWon") === "on";
  const isLost = formData.get("isLost") === "on";

  if (!label) {
    return { error: "Le libellé est requis." };
  }

  const prisma = await getTenantDb();
  const existing = await prisma.stageDefinition.findUnique({ where: { id } });
  if (!existing) {
    return { error: "Étape introuvable." };
  }

  // key is intentionally omitted from the patch — immutable once created.
  await prisma.stageDefinition.update({
    where: { id },
    data: { label, accentClass, badgeClass, dotClass, isWon, isLost },
  });

  revalidateAll();
  return { ok: true };
}

export async function deleteStageDef(id: string): Promise<StageConfigResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  const existing = await prisma.stageDefinition.findUnique({ where: { id } });
  if (!existing) {
    return { error: "Étape introuvable." };
  }

  // Which records could still be pointing at this key depends on the entity —
  // deleting a workshop status while counting only companies would orphan every
  // unit sitting in it.
  const parts: string[] = [];
  if (existing.entity === "INVENTORY_UNIT") {
    const unitCount = await prisma.inventoryUnit.count({ where: { status: existing.key } });
    if (unitCount > 0) parts.push(`${unitCount} montre(s)`);
  } else {
    const [companyCount, dealCount] = await Promise.all([
      prisma.company.count({ where: { stage: existing.key } }),
      prisma.deal.count({ where: { stage: existing.key } }),
    ]);
    if (companyCount > 0) parts.push(`${companyCount} société(s)`);
    if (dealCount > 0) parts.push(`${dealCount} deal(s)`);
  }
  if (parts.length > 0) {
    return {
      error: `Impossible de supprimer : ${parts.join(" et ")} utilisent encore cette étape.`,
    };
  }

  await prisma.stageDefinition.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}

export async function reorderStageDefs(
  orderedIds: string[],
): Promise<StageConfigResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.stageDefinition.update({ where: { id }, data: { order: index } }),
    ),
  );
  revalidateAll();
  return { ok: true };
}

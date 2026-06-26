"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";

// Phase 2 self-serve pipeline-stage editor — writes to the StageDefinition
// config store that stage-config.ts (reader) reads. ADMIN-only. `key` is
// immutable once created: it's the value stored on Company.stage/Deal.stage,
// so renaming an in-use key would orphan existing records — sidestepped
// entirely by never allowing a key edit, rather than building rename-migration.

export interface StageConfigResult {
  error?: string;
  ok?: boolean;
}

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;

function revalidateAll() {
  revalidatePath("/pipeline");
  revalidatePath("/companies");
  revalidatePath("/analytics");
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

  if (!key || !KEY_RE.test(key)) {
    return {
      error: "Clé invalide (majuscules/chiffres/underscore, doit commencer par une lettre).",
    };
  }
  if (!label) {
    return { error: "Le libellé est requis." };
  }

  const prisma = await getTenantDb();
  const existing = await prisma.stageDefinition.findUnique({ where: { key } });
  if (existing) {
    return { error: "Cette clé d'étape existe déjà." };
  }

  const maxOrder = await prisma.stageDefinition.findFirst({
    orderBy: { order: "desc" },
    select: { order: true },
  });

  await prisma.stageDefinition.create({
    data: {
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

  const [companyCount, dealCount] = await Promise.all([
    prisma.company.count({ where: { stage: existing.key } }),
    prisma.deal.count({ where: { stage: existing.key } }),
  ]);
  const total = companyCount + dealCount;
  if (total > 0) {
    const parts = [];
    if (companyCount > 0) parts.push(`${companyCount} société(s)`);
    if (dealCount > 0) parts.push(`${dealCount} deal(s)`);
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

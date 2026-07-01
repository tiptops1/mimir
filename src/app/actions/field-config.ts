"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";

// Phase 2 self-serve field editor — writes to the FieldDefinition config store
// that field-config.ts reads. ADMIN-only. NATIVE fields (source === "NATIVE",
// metadata about a real scalar column) can have label/section edited but never
// deleted or type-changed — only CUSTOM (customFields-backed) defs are fully
// editable, since deleting a NATIVE def would orphan a still-existing column.

export interface FieldConfigResult {
  error?: string;
  ok?: boolean;
}

const VALID_ENTITIES = ["COMPANY", "CONTACT", "DEAL", "FINANCE"];
const VALID_TYPES = ["text", "number", "select", "bool", "date"];
const KEY_RE = /^[a-z][a-zA-Z0-9]*$/;

function revalidateAll() {
  revalidatePath("/companies");
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/finances");
  revalidatePath("/settings/fields");
}

export async function createFieldDef(
  _prev: FieldConfigResult | undefined,
  formData: FormData,
): Promise<FieldConfigResult> {
  await requireRole(["ADMIN"]);
  const entity = String(formData.get("entity") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const type = String(formData.get("type") ?? "text");
  const section = String(formData.get("section") ?? "").trim();
  const required = formData.get("required") === "on";
  const optionsRaw = String(formData.get("options") ?? "");
  const options = optionsRaw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (!VALID_ENTITIES.includes(entity)) {
    return { error: "Entité invalide." };
  }
  if (!key || !KEY_RE.test(key)) {
    return {
      error: "Clé invalide (lettres/chiffres, doit commencer par une minuscule).",
    };
  }
  if (!label) {
    return { error: "Le libellé est requis." };
  }
  if (!VALID_TYPES.includes(type)) {
    return { error: "Type invalide." };
  }
  if (type === "select" && options.length === 0) {
    return { error: "Les champs de type liste doivent avoir au moins une option." };
  }

  const prisma = await getTenantDb();

  const existing = await prisma.fieldDefinition.findUnique({
    where: { entity_key: { entity, key } },
  });
  if (existing) {
    return { error: "Cette clé existe déjà pour cette entité." };
  }

  const maxOrder = await prisma.fieldDefinition.findFirst({
    where: { entity },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  await prisma.fieldDefinition.create({
    data: {
      entity,
      key,
      label,
      type,
      options: type === "select" ? options : [],
      required,
      section,
      source: "CUSTOM",
      order: (maxOrder?.order ?? 0) + 1,
    },
  });

  revalidateAll();
  return { ok: true };
}

export async function updateFieldDef(
  id: string,
  _prev: FieldConfigResult | undefined,
  formData: FormData,
): Promise<FieldConfigResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  const existing = await prisma.fieldDefinition.findUnique({ where: { id } });
  if (!existing) {
    return { error: "Champ introuvable." };
  }

  const label = String(formData.get("label") ?? "").trim();
  const section = String(formData.get("section") ?? "").trim();
  if (!label) {
    return { error: "Le libellé est requis." };
  }

  if (existing.source === "NATIVE") {
    // NATIVE fields back a real Prisma column — only relabel/regroup, never
    // change type/required/options/key, since that metadata must stay in sync
    // with the column it describes.
    await prisma.fieldDefinition.update({
      where: { id },
      data: { label, section },
    });
    revalidateAll();
    return { ok: true };
  }

  const type = String(formData.get("type") ?? existing.type);
  const required = formData.get("required") === "on";
  const optionsRaw = String(formData.get("options") ?? "");
  const options = optionsRaw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (!VALID_TYPES.includes(type)) {
    return { error: "Type invalide." };
  }
  if (type === "select" && options.length === 0) {
    return { error: "Les champs de type liste doivent avoir au moins une option." };
  }

  await prisma.fieldDefinition.update({
    where: { id },
    data: {
      label,
      section,
      type,
      required,
      options: type === "select" ? options : [],
    },
  });

  revalidateAll();
  return { ok: true };
}

export async function deleteFieldDef(id: string): Promise<FieldConfigResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  const existing = await prisma.fieldDefinition.findUnique({ where: { id } });
  if (!existing) {
    return { error: "Champ introuvable." };
  }
  if (existing.source === "NATIVE") {
    return {
      error: "Impossible de supprimer un champ natif (lié à une colonne existante).",
    };
  }

  await prisma.fieldDefinition.delete({ where: { id } });
  revalidateAll();
  return { ok: true };
}

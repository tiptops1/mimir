"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession, requireRole } from "@/lib/dal";
import { companySchema, activitySchema } from "@/lib/validations";
import { mirrorStageToPrimaryDeal } from "@/lib/deals";
import { getStageDefs } from "@/lib/stage-config";
import { recordStageChange } from "@/lib/stage-history";
import { logAudit } from "@/lib/audit";

export interface FormResult {
  error?: string;
  ok?: boolean;
}

function dataFromForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  return companySchema.safeParse(raw);
}

/** Stage is config data (StageDefinition), not a Zod enum — check it here. */
async function ensureValidStage(data: { stage: string }): Promise<void> {
  const keys = (await getStageDefs()).map((s) => s.value);
  if (!keys.includes(data.stage)) data.stage = keys[0];
}

export async function createCompany(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();
  const parsed = dataFromForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  await ensureValidStage(parsed.data);

  const existing = await prisma.company.findUnique({
    where: { siret: parsed.data.siret },
  });
  if (existing) {
    return { error: "Une société avec ce SIRET existe déjà." };
  }

  const company = await prisma.company.create({ data: parsed.data });
  // Entry point of the pipeline history (from: null = initial stage).
  await recordStageChange(prisma, {
    companyId: company.id,
    from: null,
    to: company.stage,
  });
  revalidatePath("/companies");
  revalidatePath("/pipeline");
  redirect(`/companies/${company.id}`);
}

export async function updateCompany(
  id: string,
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const parsed = dataFromForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  await ensureValidStage(parsed.data);

  const before = await prisma.company.findUnique({
    where: { id },
    select: { stage: true },
  });
  await prisma.company.update({ where: { id }, data: parsed.data });
  if (before && before.stage !== parsed.data.stage) {
    await recordStageChange(prisma, {
      companyId: id,
      from: before.stage,
      to: parsed.data.stage,
      userId: session.userId,
    });
  }
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function setPreferredChannel(
  id: string,
  value: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const allowed = ["PHONE", "EMAIL", "LINKEDIN"];
  await prisma.company.update({
    where: { id },
    data: { canalPrefere: allowed.includes(value) ? value : null },
  });
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
}

const SPECIALTY_KEYS = [
  "specialiteSante",
  "specialitePrevoyance",
  "specialiteIard",
  "specialiteAuto",
  "specialiteRcPro",
  "specialiteEntreprises",
  "specialiteCollectives",
  "specialiteParticuliers",
] as const;

/** Replace the full set of specialty booleans from a list of active keys. */
export async function setCompanySpecialties(
  id: string,
  activeKeys: string[],
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const data = Object.fromEntries(
    SPECIALTY_KEYS.map((k) => [k, activeKeys.includes(k)]),
  );
  await prisma.company.update({ where: { id }, data });
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
}

// Whitelist of inline-editable enum fields → their allowed values.
// `nullable` fields accept "" to clear the value. `stage` isn't listed here —
// its allow-list is config data (StageDefinition), fetched in setCompanyEnum.
const ENUM_FIELDS = {
  priorite: { values: ["A", "B", "C"], nullable: true },
  potentiel: { values: ["FAIBLE", "MOYEN", "FORT"], nullable: true },
} as const;

export type EnumField = "stage" | keyof typeof ENUM_FIELDS;

/** Inline-edit a single enum column (stage / priorité / potentiel) from the table. */
export async function setCompanyEnum(
  id: string,
  field: EnumField,
  value: string,
): Promise<void> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  let next: string | null;
  if (field === "stage") {
    const stageKeys = (await getStageDefs()).map((s) => s.value);
    if (!stageKeys.includes(value)) return;
    next = value;
  } else {
    const def = ENUM_FIELDS[field];
    if (!def) return;
    if (def.values.includes(value as never)) {
      next = value;
    } else if (def.nullable && value === "") {
      next = null;
    } else {
      return; // ignore invalid values rather than throwing
    }
  }
  const before =
    field === "stage"
      ? await prisma.company.findUnique({ where: { id }, select: { stage: true } })
      : null;
  await prisma.company.update({ where: { id }, data: { [field]: next } });
  // Keep the primary deal in sync when the pipeline stage changes inline.
  if (field === "stage" && next) {
    await mirrorStageToPrimaryDeal(prisma, id, next);
    await recordStageChange(prisma, {
      companyId: id,
      from: before?.stage ?? null,
      to: next,
      userId: session.userId,
    });
  }
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  revalidatePath("/pipeline");
}

/**
 * Bulk variant of setCompanyEnum: apply one enum change to a selection of
 * companies (Suivi bulk bar). Same validation; stage changes mirror to each
 * primary deal, same as the single-row path.
 */
export async function bulkSetCompanyEnum(
  ids: string[],
  field: EnumField,
  value: string,
): Promise<{ updated: number }> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const unique = [...new Set(ids)].slice(0, 500); // safety cap
  if (unique.length === 0) return { updated: 0 };

  let next: string | null;
  if (field === "stage") {
    const stageKeys = (await getStageDefs()).map((s) => s.value);
    if (!stageKeys.includes(value)) return { updated: 0 };
    next = value;
  } else {
    const def = ENUM_FIELDS[field];
    if (!def) return { updated: 0 };
    if (def.values.includes(value as never)) {
      next = value;
    } else if (def.nullable && value === "") {
      next = null;
    } else {
      return { updated: 0 };
    }
  }

  const before =
    field === "stage"
      ? await prisma.company.findMany({
          where: { id: { in: unique } },
          select: { id: true, stage: true },
        })
      : [];
  const res = await prisma.company.updateMany({
    where: { id: { in: unique } },
    data: { [field]: next },
  });
  if (field === "stage" && next) {
    for (const id of unique) {
      await mirrorStageToPrimaryDeal(prisma, id, next);
    }
    for (const b of before) {
      await recordStageChange(prisma, {
        companyId: b.id,
        from: b.stage,
        to: next,
        userId: session.userId,
      });
    }
  }
  revalidatePath("/companies");
  revalidatePath("/pipeline");
  return { updated: res.count };
}

/** Inline-edit the free-text notes / next-steps field. */
export async function setCompanyNotes(
  id: string,
  notes: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const trimmed = notes.trim();
  await prisma.company.update({
    where: { id },
    data: { notes: trimmed || null },
  });
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
}

export async function deleteCompany(id: string): Promise<void> {
  const session = await requireRole(["ADMIN", "MANAGER"]);
  const prisma = await getTenantDb();
  await logAudit(prisma, {
    userId: session.userId,
    action: "DELETE_COMPANY",
    entity: "COMPANY",
    entityId: id,
    details: "suppression société + contacts/activités/tâches liés",
  });
  await prisma.activity.deleteMany({ where: { companyId: id } });
  await prisma.task.deleteMany({ where: { companyId: id } });
  await prisma.contact.deleteMany({ where: { companyId: id } });
  await prisma.stageChange.deleteMany({ where: { companyId: id } });
  await prisma.company.delete({ where: { id } });
  revalidatePath("/companies");
  revalidatePath("/pipeline");
  redirect("/companies");
}

export async function addActivity(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  const session = await verifySession();
  const prisma = await getTenantDb();
  const parsed = activitySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: "Activité invalide." };
  }
  await prisma.activity.create({
    data: {
      companyId: parsed.data.companyId,
      type: parsed.data.type,
      note: parsed.data.note,
      userId: session.userId,
    },
  });
  await prisma.company.update({
    where: { id: parsed.data.companyId },
    data: { dernierContact: new Date() },
  });
  revalidatePath(`/companies/${parsed.data.companyId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

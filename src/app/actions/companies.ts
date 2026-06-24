"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession, requireRole } from "@/lib/dal";
import { companySchema, activitySchema } from "@/lib/validations";

export interface FormResult {
  error?: string;
  ok?: boolean;
}

function dataFromForm(formData: FormData) {
  const raw = Object.fromEntries(formData.entries());
  return companySchema.safeParse(raw);
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

  const existing = await prisma.company.findUnique({
    where: { siret: parsed.data.siret },
  });
  if (existing) {
    return { error: "Une société avec ce SIRET existe déjà." };
  }

  const company = await prisma.company.create({ data: parsed.data });
  revalidatePath("/companies");
  revalidatePath("/pipeline");
  redirect(`/companies/${company.id}`);
}

export async function updateCompany(
  id: string,
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();
  const parsed = dataFromForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  await prisma.company.update({ where: { id }, data: parsed.data });
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
// `nullable` fields accept "" to clear the value.
const ENUM_FIELDS = {
  stage: {
    values: [
      "A_QUALIFIER",
      "A_CONTACTER",
      "CONTACTE",
      "RDV_OBTENU",
      "DEMO_REALISEE",
      "PROPOSITION_ENVOYEE",
      "GAGNE",
      "PERDU",
    ],
    nullable: false,
  },
  priorite: { values: ["A", "B", "C"], nullable: true },
  potentiel: { values: ["FAIBLE", "MOYEN", "FORT"], nullable: true },
} as const;

export type EnumField = keyof typeof ENUM_FIELDS;

/** Inline-edit a single enum column (stage / priorité / potentiel) from the table. */
export async function setCompanyEnum(
  id: string,
  field: EnumField,
  value: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const def = ENUM_FIELDS[field];
  if (!def) return;
  let next: string | null;
  if (def.values.includes(value as never)) {
    next = value;
  } else if (def.nullable && value === "") {
    next = null;
  } else {
    return; // ignore invalid values rather than throwing
  }
  await prisma.company.update({ where: { id }, data: { [field]: next } });
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  revalidatePath("/pipeline");
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
  await requireRole(["ADMIN", "MANAGER"]);
  const prisma = await getTenantDb();
  await prisma.activity.deleteMany({ where: { companyId: id } });
  await prisma.task.deleteMany({ where: { companyId: id } });
  await prisma.contact.deleteMany({ where: { companyId: id } });
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

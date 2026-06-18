"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
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
  const allowed = ["PHONE", "EMAIL", "LINKEDIN"];
  await prisma.company.update({
    where: { id },
    data: { canalPrefere: allowed.includes(value) ? value : null },
  });
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
}

export async function deleteCompany(id: string): Promise<void> {
  await requireRole(["ADMIN", "MANAGER"]);
  await prisma.activity.deleteMany({ where: { companyId: id } });
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

"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { verifySession, requireRole } from "@/lib/dal";
import { contactSchema } from "@/lib/validations";

export interface FormResult {
  error?: string;
  ok?: boolean;
}

export async function createContact(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const parsed = contactSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  await prisma.contact.create({ data: parsed.data });
  revalidatePath(`/companies/${parsed.data.companyId}`);
  revalidatePath("/contacts");
  return { ok: true };
}

export async function updateContact(
  id: string,
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const parsed = contactSchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  await prisma.contact.update({ where: { id }, data: parsed.data });
  revalidatePath(`/companies/${parsed.data.companyId}`);
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  return { ok: true };
}

export async function toggleDecisionMaker(
  id: string,
  companyId: string,
  value: boolean,
): Promise<void> {
  await verifySession();
  await prisma.contact.update({
    where: { id },
    data: { isDecisionMaker: value },
  });
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/contacts");
}

export async function deleteContact(
  id: string,
  companyId: string,
): Promise<void> {
  await requireRole(["ADMIN", "MANAGER"]);
  await prisma.activity.updateMany({
    where: { contactId: id },
    data: { contactId: null },
  });
  await prisma.contact.delete({ where: { id } });
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/contacts");
}

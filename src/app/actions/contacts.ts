"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTenantDb } from "@/lib/tenant-context";
import { verifySession, requireRole } from "@/lib/dal";
import { contactSchema } from "@/lib/validations";
import { SPECIALTY_FIELDS } from "@/lib/constants";

export interface FormResult {
  error?: string;
  ok?: boolean;
}

/**
 * Create a contact from the standalone "Nouveau contact" page. The contact
 * either attaches to an existing company (companyMode=existing, companyId) or
 * creates a brand-new company inline (companyMode=new, nomSociete).
 *
 * A hand-added company has no SIRET yet, but SIRET is required + unique (it's
 * the dedupe key for registry imports). We mint a clearly-temporary placeholder
 * (`MANUEL-<uuid>`) so the flow never asks Chris for a number he doesn't have;
 * the real SIRET can be filled later from the company page / enrichment.
 */
export async function createContactWithCompany(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();

  const str = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  let companyId: string;
  if (formData.get("companyMode") === "new") {
    const nomSociete = str("nomSociete");
    if (!nomSociete) return { error: "Le nom de la société est requis." };
    const company = await prisma.company.create({
      data: {
        siret: `MANUEL-${randomUUID()}`,
        nomSociete,
        siteWeb: str("siteWeb"),
        // A hand-added prospect is, by definition, one Chris is now tracking —
        // stamp datePremierContact so it shows up in Suivi immediately (Suivi
        // only lists companies with an activity / premier / dernier contact).
        datePremierContact: new Date(),
        ...Object.fromEntries(
          SPECIALTY_FIELDS.map((f) => [f.key, formData.get(f.key) === "on"]),
        ),
      },
    });
    companyId = company.id;
  } else {
    const existing = str("companyId");
    if (!existing) return { error: "Veuillez choisir une société." };
    companyId = existing;
    // Adding a contact to an existing (e.g. imported) company means Chris is
    // engaging it now — surface it in Suivi without clobbering an earlier date.
    await prisma.company.updateMany({
      where: { id: companyId, datePremierContact: null },
      data: { datePremierContact: new Date() },
    });
  }

  const parsed = contactSchema.safeParse({
    companyId,
    nom: formData.get("nom"),
    prenom: formData.get("prenom"),
    email: formData.get("email"),
    telephone: formData.get("telephone"),
    linkedinUrl: formData.get("linkedinUrl"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }

  await prisma.contact.create({
    data: { ...parsed.data, isDecisionMaker: formData.get("isDecisionMaker") === "on" },
  });

  revalidatePath("/companies");
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  redirect(`/companies/${companyId}`);
}

export async function createContact(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();
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
  const prisma = await getTenantDb();
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
  const prisma = await getTenantDb();
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
  const prisma = await getTenantDb();
  await prisma.activity.updateMany({
    where: { contactId: id },
    data: { contactId: null },
  });
  await prisma.contact.delete({ where: { id } });
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/contacts");
}

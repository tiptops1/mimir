"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";

// Merge actions for the /settings/duplicates review page. ADMIN-only and
// destructive by nature: the merged rows are deleted after their children are
// reattached to the keeper, so everything is reassign-then-delete, no cascade.

export interface MergeResult {
  error?: string;
  ok?: boolean;
  merged?: number;
}

function revalidateLists() {
  revalidatePath("/companies");
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/settings/duplicates");
}

/** Keeper-wins scalar fill: null/empty keeper fields take the merged value. */
function fillBlanks<T extends Record<string, unknown>>(
  keeper: T,
  merged: T[],
  fields: Array<keyof T>,
): Partial<T> {
  const patch: Partial<T> = {};
  for (const f of fields) {
    const kept = keeper[f];
    if (kept !== null && kept !== undefined && kept !== "" && kept !== false)
      continue;
    for (const m of merged) {
      const v = m[f];
      if (v !== null && v !== undefined && v !== "" && v !== false) {
        patch[f] = v;
        break;
      }
    }
  }
  return patch;
}

const COMPANY_FILL_FIELDS = [
  "siren",
  "nomSociete",
  "enseigne",
  "categorieEntreprise",
  "formeJuridique",
  "dateCreation",
  "codeNaf",
  "libelleNaf",
  "trancheEffectifs",
  "adresse",
  "codePostal",
  "ville",
  "siteWeb",
  "emailGenerique",
  "telephoneStandard",
  "chiffreAffaires",
  "canalPrefere",
  "nbCollaborateursEstime",
  "niveauDigitalisation",
  "icpScore",
  "priorite",
  "potentiel",
  "canal",
  "closingEstime",
  "specialiteSante",
  "specialitePrevoyance",
  "specialiteIard",
  "specialiteAuto",
  "specialiteRcPro",
  "specialiteEntreprises",
  "specialiteCollectives",
  "specialiteParticuliers",
] as const;

export async function mergeCompanies(
  keepId: string,
  mergeIds: string[],
): Promise<MergeResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();

  const ids = [...new Set(mergeIds)].filter((id) => id !== keepId).slice(0, 20);
  if (ids.length === 0) return { error: "Rien à fusionner." };

  const [keeper, merged] = await Promise.all([
    prisma.company.findUnique({ where: { id: keepId } }),
    prisma.company.findMany({ where: { id: { in: ids } } }),
  ]);
  if (!keeper) return { error: "Société à conserver introuvable." };
  if (merged.length !== ids.length)
    return { error: "Une des sociétés à fusionner est introuvable." };

  // 1. Reattach every child to the keeper.
  const move = { where: { companyId: { in: ids } }, data: { companyId: keepId } };
  await prisma.contact.updateMany(move);
  await prisma.activity.updateMany(move);
  await prisma.task.updateMany(move);
  await prisma.deal.updateMany(move);
  await prisma.enrollment.updateMany(move);
  await prisma.financeEntry.updateMany(move);
  await prisma.stageChange.updateMany(move);

  // 2. Exactly one primary deal survives (the keeper's; else the oldest moved one).
  const primaries = await prisma.deal.findMany({
    where: { companyId: keepId, isPrimary: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (primaries.length > 1) {
    await prisma.deal.updateMany({
      where: { id: { in: primaries.slice(1).map((d) => d.id) } },
      data: { isPrimary: false },
    });
  }

  // 3. Fill the keeper's blanks from the merged rows; merge dates + notes +
  //    custom fields (keeper wins on conflicts).
  const patch: Record<string, unknown> = fillBlanks(
    keeper as unknown as Record<string, unknown>,
    merged as unknown as Record<string, unknown>[],
    [...COMPANY_FILL_FIELDS],
  );
  const firstDates = [keeper, ...merged]
    .map((c) => c.datePremierContact)
    .filter((d): d is Date => Boolean(d));
  if (firstDates.length)
    patch.datePremierContact = new Date(Math.min(...firstDates.map(Number)));
  const lastDates = [keeper, ...merged]
    .map((c) => c.dernierContact)
    .filter((d): d is Date => Boolean(d));
  if (lastDates.length)
    patch.dernierContact = new Date(Math.max(...lastDates.map(Number)));
  const notes = [keeper.notes, ...merged.map((m) => m.notes)].filter(Boolean);
  if (notes.length > 1) patch.notes = notes.join("\n---\n");
  const customFields = Object.assign(
    {},
    ...merged.map((m) => (m.customFields as object) ?? {}),
    (keeper.customFields as object) ?? {},
  );
  if (Object.keys(customFields).length) patch.customFields = customFields;

  await prisma.company.update({ where: { id: keepId }, data: patch });

  // 4. Drop the merged shells (children are already gone).
  await prisma.company.deleteMany({ where: { id: { in: ids } } });

  revalidateLists();
  return { ok: true, merged: ids.length };
}

const CONTACT_FILL_FIELDS = [
  "nom",
  "prenom",
  "fonction",
  "email",
  "telephone",
  "linkedinUrl",
  "isDecisionMaker",
] as const;

export async function mergeContacts(
  keepId: string,
  mergeIds: string[],
): Promise<MergeResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();

  const ids = [...new Set(mergeIds)].filter((id) => id !== keepId).slice(0, 20);
  if (ids.length === 0) return { error: "Rien à fusionner." };

  const [keeper, merged] = await Promise.all([
    prisma.contact.findUnique({ where: { id: keepId } }),
    prisma.contact.findMany({ where: { id: { in: ids } } }),
  ]);
  if (!keeper) return { error: "Contact à conserver introuvable." };
  if (merged.length !== ids.length)
    return { error: "Un des contacts à fusionner est introuvable." };

  const move = { where: { contactId: { in: ids } }, data: { contactId: keepId } };
  await prisma.activity.updateMany(move);
  await prisma.task.updateMany(move);
  await prisma.enrollment.updateMany(move);

  const patch: Record<string, unknown> = fillBlanks(
    keeper as unknown as Record<string, unknown>,
    merged as unknown as Record<string, unknown>[],
    [...CONTACT_FILL_FIELDS],
  );
  const customFields = Object.assign(
    {},
    ...merged.map((m) => (m.customFields as object) ?? {}),
    (keeper.customFields as object) ?? {},
  );
  if (Object.keys(customFields).length) patch.customFields = customFields;

  await prisma.contact.update({ where: { id: keepId }, data: patch });
  await prisma.contact.deleteMany({ where: { id: { in: ids } } });

  revalidateLists();
  return { ok: true, merged: ids.length };
}

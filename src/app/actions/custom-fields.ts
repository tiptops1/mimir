"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { getFieldDefs, coerceFieldValue, readCustomFields } from "@/lib/field-config";

// Write a single tenant-defined custom field onto a company's flexible
// `customFields` document (no schema migration to add a field). Validated against
// the FieldDefinition config; unknown keys are ignored.
export async function setCompanyCustomField(
  companyId: string,
  key: string,
  raw: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const def = (await getFieldDefs("COMPANY")).find((d) => d.key === key);
  if (!def) return;

  const value = coerceFieldValue(def, raw);
  const current = await prisma.company.findUnique({
    where: { id: companyId },
    select: { customFields: true },
  });
  const cf = readCustomFields(current?.customFields);
  if (value === null) delete cf[key];
  else cf[key] = value;

  await prisma.company.update({
    where: { id: companyId },
    data: { customFields: cf as Prisma.InputJsonValue },
  });
  revalidatePath(`/companies/${companyId}`);
}

// Chronos sibling. A separate function rather than an entity-parameterised one:
// the entity, the Prisma delegate and the revalidate path all differ, so the
// parameterised version would be three switches wearing one signature.
export async function setUnitCustomField(
  unitId: string,
  key: string,
  raw: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const def = (await getFieldDefs("INVENTORY_UNIT")).find((d) => d.key === key);
  if (!def) return;

  const value = coerceFieldValue(def, raw);
  const current = await prisma.inventoryUnit.findUnique({
    where: { id: unitId },
    select: { customFields: true },
  });
  const cf = readCustomFields(current?.customFields);
  if (value === null) delete cf[key];
  else cf[key] = value;

  await prisma.inventoryUnit.update({
    where: { id: unitId },
    data: { customFields: cf as Prisma.InputJsonValue },
  });
  revalidatePath(`/chronos/${unitId}`);
}

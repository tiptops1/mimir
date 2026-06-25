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

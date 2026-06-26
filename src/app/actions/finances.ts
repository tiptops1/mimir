"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { financeEntrySchema } from "@/lib/validations";
import {
  kindDirection,
  statusOptionsFor,
  defaultStatusFor,
  type FinanceKind,
} from "@/lib/finance";
import type { FormResult } from "@/app/actions/companies";

// CRUD + inline edits for the Finances cockpit. Mirrors actions/deals.ts:
// verifySession → getTenantDb → validate → write → revalidate. `direction` and
// `status` are derived/validated here from `kind`, never trusted from the form.

function revalidateFinance() {
  revalidatePath("/finances");
  revalidatePath("/dashboard");
}

/** Coerce the validated status to a value legal for the kind (fallback = default). */
function resolveStatus(kind: FinanceKind, raw: string | null): string {
  const allowed = statusOptionsFor(kind).map((s) => s.value);
  return raw && allowed.includes(raw) ? raw : defaultStatusFor(kind);
}

export async function createFinanceEntry(
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();
  const parsed = financeEntrySchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const d = parsed.data;
  await prisma.financeEntry.create({
    data: {
      direction: kindDirection(d.kind),
      kind: d.kind,
      label: d.label,
      vendor: d.vendor,
      category: d.category,
      amount: d.amount ?? 0,
      currency: d.currency,
      recurrence: d.recurrence,
      status: resolveStatus(d.kind, d.status),
      date: d.date,
      startDate: d.startDate,
      endDate: d.endDate,
      trialEndsAt: d.trialEndsAt,
      renewsAt: d.renewsAt,
      dueDate: d.dueDate,
      autoRenew: d.autoRenew,
      notes: d.notes,
      companyId: d.companyId,
    },
  });
  revalidateFinance();
  return { ok: true };
}

export async function updateFinanceEntry(
  id: string,
  _prev: FormResult | undefined,
  formData: FormData,
): Promise<FormResult> {
  await verifySession();
  const prisma = await getTenantDb();
  const parsed = financeEntrySchema.safeParse(
    Object.fromEntries(formData.entries()),
  );
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides." };
  }
  const d = parsed.data;
  await prisma.financeEntry.update({
    where: { id },
    data: {
      direction: kindDirection(d.kind),
      kind: d.kind,
      label: d.label,
      vendor: d.vendor,
      category: d.category,
      amount: d.amount ?? 0,
      currency: d.currency,
      recurrence: d.recurrence,
      status: resolveStatus(d.kind, d.status),
      date: d.date,
      startDate: d.startDate,
      endDate: d.endDate,
      trialEndsAt: d.trialEndsAt,
      renewsAt: d.renewsAt,
      dueDate: d.dueDate,
      autoRenew: d.autoRenew,
      notes: d.notes,
      companyId: d.companyId,
    },
  });
  revalidatePath(`/finances/${id}`);
  revalidateFinance();
  return { ok: true };
}

export async function deleteFinanceEntry(id: string): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  await prisma.financeEntry.delete({ where: { id } });
  revalidateFinance();
}

/** Inline status change from a badge dropdown (kind-validated). */
export async function setFinanceStatus(
  id: string,
  status: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const entry = await prisma.financeEntry.findUnique({
    where: { id },
    select: { kind: true },
  });
  if (!entry) return;
  const next = resolveStatus(entry.kind as FinanceKind, status);
  await prisma.financeEntry.update({ where: { id }, data: { status: next } });
  revalidateFinance();
}

// Single-field inline edits. Whitelisted so an inline cell can save one field
// without re-submitting the whole form (mirrors setCompanyNotes/setCompanyEnum).
const STRING_FIELDS = new Set(["label", "vendor", "category", "notes"]);
const DATE_FIELDS = new Set([
  "date",
  "startDate",
  "endDate",
  "trialEndsAt",
  "renewsAt",
  "dueDate",
]);

export async function setFinanceField(
  id: string,
  field: string,
  raw: string,
): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();

  let data: Record<string, unknown> | null = null;
  const value = raw.trim();

  if (field === "amount") {
    const digits = value.replace(/[^0-9]/g, "");
    data = { amount: digits ? Number.parseInt(digits, 10) : 0 };
  } else if (field === "recurrence") {
    if (["NONE", "MONTHLY", "QUARTERLY", "ANNUAL"].includes(value)) {
      data = { recurrence: value };
    }
  } else if (STRING_FIELDS.has(field)) {
    if (field === "label" && !value) return; // label is required
    data = { [field]: value || null };
  } else if (DATE_FIELDS.has(field)) {
    const d = value ? new Date(value) : null;
    data = { [field]: d && !Number.isNaN(d.getTime()) ? d : null };
  }

  if (!data) return;
  await prisma.financeEntry.update({ where: { id }, data });
  revalidatePath(`/finances/${id}`);
  revalidateFinance();
}

/** Set the editable "trésorerie / cash-on-hand" backing the cockpit runway. */
export async function setCashOnHand(raw: string): Promise<void> {
  await verifySession();
  const prisma = await getTenantDb();
  const value = String(Number.parseInt(raw.replace(/[^0-9]/g, ""), 10) || 0);
  await prisma.setting.upsert({
    where: { key: "finance.cashOnHand" },
    create: { key: "finance.cashOnHand", value },
    update: { value },
  });
  revalidateFinance();
}

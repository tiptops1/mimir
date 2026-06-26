import type { PrismaClient } from "@prisma/client";

// Thin reader over the tenant Setting key/value store. Writes go through a
// server action (actions/finances.ts setCashOnHand). Values are strings;
// numeric callers parse here.

export const SETTINGS = {
  cashOnHand: "finance.cashOnHand",
} as const;

export async function getSetting(
  prisma: PrismaClient,
  key: string,
): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function getNumberSetting(
  prisma: PrismaClient,
  key: string,
): Promise<number | null> {
  const raw = await getSetting(prisma, key);
  if (raw == null) return null;
  const n = Number.parseInt(raw.replace(/[^0-9-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

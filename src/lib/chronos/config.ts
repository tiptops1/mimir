import type { PrismaClient } from "@prisma/client";
import type { MarketplaceFeeModel } from "./margin";

/**
 * Chronos (S27b) — typed readers over the ChronosConfig singleton's Json
 * columns.
 *
 * `marketplaces` and `feeModel` are Json by design (a tenant adds a marketplace
 * without a migration), which means every consumer would otherwise re-derive
 * the same defensive parse. These narrow once, tolerate a malformed or absent
 * document, and never throw — a broken config row must not take the inventory
 * page down with it.
 *
 * Tenant PrismaClient first, per the module convention.
 */

export interface Marketplace {
  key: string;
  label: string;
  /** "api" | "manual" — manual is first-class: most resale sites have no API. */
  sync: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseMarketplaces(value: unknown): Marketplace[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.key !== "string" || !entry.key) return [];
    return [
      {
        key: entry.key,
        label: typeof entry.label === "string" && entry.label ? entry.label : entry.key,
        sync: typeof entry.sync === "string" ? entry.sync : "manual",
      },
    ];
  });
}

export async function readMarketplaces(prisma: PrismaClient): Promise<Marketplace[]> {
  const config = await prisma.chronosConfig.findUnique({
    where: { singleton: "default" },
    select: { marketplaces: true },
  });
  return parseMarketplaces(config?.marketplaces);
}

export async function readTargetMarginPct(prisma: PrismaClient): Promise<number> {
  const config = await prisma.chronosConfig.findUnique({
    where: { singleton: "default" },
    select: { targetMarginPct: true },
  });
  return config?.targetMarginPct ?? 25;
}

/** Fee model for one marketplace, or undefined — estimateFees handles that. */
export async function readFeeModel(
  prisma: PrismaClient,
  marketplaceKey: string,
): Promise<MarketplaceFeeModel | undefined> {
  const config = await prisma.chronosConfig.findUnique({
    where: { singleton: "default" },
    select: { feeModel: true },
  });
  const all = config?.feeModel;
  if (!isRecord(all)) return undefined;
  const entry = all[marketplaceKey];
  return isRecord(entry) ? (entry as MarketplaceFeeModel) : undefined;
}

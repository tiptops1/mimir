import "server-only";
import { cache } from "react";
import { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { getTenantPrisma } from "@/lib/tenant-db";
import { getTenantRecord } from "@/lib/tenant-profile";

/**
 * The DB router's entry point for request-scoped tenant-data access.
 *
 * Resolves the active tenant from the session, looks up its (encrypted)
 * connection string in the control plane, and returns the cached tenant client.
 * Memoized per request via React `cache` so a page + its actions share one
 * lookup. Every tenant-data read/write goes through this — never import a bare
 * PrismaClient for tenant data.
 *
 * The control-row lookup itself lives in src/lib/tenant-profile.ts and is shared
 * with the entitlement resolver, so routing + module gating cost one query.
 */
export const getTenantDb = cache(async (): Promise<PrismaClient> => {
  const tenant = await getTenantRecord();
  return getTenantPrisma(decrypt(tenant.connectionString));
});

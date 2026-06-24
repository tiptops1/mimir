import "server-only";
import { cache } from "react";
import { PrismaClient } from "@prisma/client";
import { verifySession } from "@/lib/dal";
import { controlPrisma } from "@/lib/control-db";
import { decrypt } from "@/lib/crypto";
import { getTenantPrisma } from "@/lib/tenant-db";

/**
 * The DB router's entry point for request-scoped tenant-data access.
 *
 * Resolves the active tenant from the session, looks up its (encrypted)
 * connection string in the control plane, and returns the cached tenant client.
 * Memoized per request via React `cache` so a page + its actions share one
 * lookup. Every tenant-data read/write goes through this — never import a bare
 * PrismaClient for tenant data.
 */
export const getTenantDb = cache(async (): Promise<PrismaClient> => {
  const session = await verifySession();
  const tenant = await controlPrisma.tenant.findUnique({
    where: { id: session.tenantId },
  });
  if (!tenant || tenant.status !== "ACTIVE") {
    throw new Error(`No active tenant for session (tenantId=${session.tenantId})`);
  }
  return getTenantPrisma(decrypt(tenant.connectionString));
});

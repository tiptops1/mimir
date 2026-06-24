import { PrismaClient } from "@prisma/client";

// The DB router's low level: one tenant-data PrismaClient per connection string,
// cached so we don't open a new connection pool on every request. A connection
// string can later point at a tenant's OWN cluster with no change here — that's
// the whole reason the control plane stores the full string (see architecture.md).
const globalForTenants = globalThis as unknown as {
  tenantClients?: Map<string, PrismaClient>;
};

const clients = globalForTenants.tenantClients ?? new Map<string, PrismaClient>();
if (process.env.NODE_ENV !== "production") {
  globalForTenants.tenantClients = clients;
}

/**
 * Phase 0 single-tenant escape hatch for SESSION-LESS server contexts (the cron
 * route, CLI sync scripts): returns the tenant-#1 client from DATABASE_URL.
 * Phase 3 replaces this with per-tenant routing of ingestion — until then,
 * ingestion stays single-tenant by design (not a regression).
 */
export function getTenant1Prisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return getTenantPrisma(url);
}

/** Resolve (and cache) the tenant-data client for a given connection string. */
export function getTenantPrisma(connectionString: string): PrismaClient {
  let client = clients.get(connectionString);
  if (!client) {
    client = new PrismaClient({
      datasourceUrl: connectionString,
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
    clients.set(connectionString, client);
  }
  return client;
}

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

// S28 removed `getTenant1Prisma()`, the Phase 0 single-tenant escape hatch: it
// resolved a client straight from DATABASE_URL, bypassing the control plane. It
// had no callers left, and with a production cluster in existence a function
// that reads a raw env var into a live client is precisely the shape of an
// accidental cross-environment write. Session-less contexts go through
// listActiveTenants() (src/lib/tenant-cron.ts) instead.

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

import { PrismaClient } from "@/generated/control";

// Singleton client for the CONTROL plane (tenants, users, memberships).
// Mirrors the dev hot-reload guard used for the tenant client.
const globalForControl = globalThis as unknown as {
  controlPrisma?: PrismaClient;
};

export const controlPrisma =
  globalForControl.controlPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForControl.controlPrisma = controlPrisma;
}

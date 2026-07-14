import { controlPrisma } from "@/lib/control-db";
import { encrypt, decrypt } from "@/lib/crypto";

// No "server-only" guard (like crypto.ts): the session-less sync scripts (tsx)
// reuse these helpers, and server-only throws outside an RSC bundle.

// Control-plane access to a tenant's connected third-party accounts. The OAuth
// refresh token is encrypted with the same AES-256-GCM helper that protects
// tenant connection strings (src/lib/crypto.ts). Mirrors tenant-context.ts in
// style: thin helpers the routes / cron / scripts call, never a bare client.

const GOOGLE = "google";
const FIREFLIES = "fireflies";

// A tenant can hold TWO Google connections, told apart by `purpose`:
// MAIN = the owner's real mailbox (ingestion, digest) — the historical default;
// OUTREACH = the cold-email sender inbox on the secondary domain. Every helper
// below defaults to MAIN so pre-outreach call sites are unchanged.
export type GooglePurpose = "MAIN" | "OUTREACH";

/** A Google integration with its refresh token already decrypted, ready to use. */
export interface GoogleCredential {
  tenantId: string;
  accountEmail: string;
  refreshToken: string;
  scopes: string[];
  lastSyncedAt: Date | null;
}

/** Public view of the connection for the UI (no secret material). */
export interface GoogleConnection {
  accountEmail: string;
  scopes: string[];
  connectedAt: Date;
  lastSyncedAt: Date | null;
}

/** Connection status for a tenant, safe to pass to a client component. */
export async function getGoogleConnection(
  tenantId: string,
  purpose: GooglePurpose = "MAIN",
): Promise<GoogleConnection | null> {
  const row = await controlPrisma.integration.findUnique({
    where: {
      tenantId_provider_purpose: { tenantId, provider: GOOGLE, purpose },
    },
  });
  if (!row || row.status !== "ACTIVE") return null;
  return {
    accountEmail: row.accountEmail,
    scopes: row.scopes,
    connectedAt: row.connectedAt,
    lastSyncedAt: row.lastSyncedAt,
  };
}

/** The credential incl. decrypted refresh token, for server-side API calls. */
export async function getGoogleCredential(
  tenantId: string,
  purpose: GooglePurpose = "MAIN",
): Promise<GoogleCredential | null> {
  const row = await controlPrisma.integration.findUnique({
    where: {
      tenantId_provider_purpose: { tenantId, provider: GOOGLE, purpose },
    },
  });
  if (!row || row.status !== "ACTIVE") return null;
  return {
    tenantId: row.tenantId,
    accountEmail: row.accountEmail,
    refreshToken: decrypt(row.refreshToken),
    scopes: row.scopes,
    lastSyncedAt: row.lastSyncedAt,
  };
}

/** Create or replace a Google connection for a tenant (encrypts the token). */
export async function upsertGoogleIntegration(args: {
  tenantId: string;
  accountEmail: string;
  refreshToken: string;
  scopes: string[];
  purpose?: GooglePurpose;
}): Promise<void> {
  const purpose = args.purpose ?? "MAIN";
  const data = {
    accountEmail: args.accountEmail,
    refreshToken: encrypt(args.refreshToken),
    scopes: args.scopes,
    status: "ACTIVE",
  };
  await controlPrisma.integration.upsert({
    where: {
      tenantId_provider_purpose: {
        tenantId: args.tenantId,
        provider: GOOGLE,
        purpose,
      },
    },
    update: data,
    create: { tenantId: args.tenantId, provider: GOOGLE, purpose, ...data },
  });
}

/** Remove a Google connection for a tenant (after revoking at Google). */
export async function deleteGoogleIntegration(
  tenantId: string,
  purpose: GooglePurpose = "MAIN",
): Promise<void> {
  await controlPrisma.integration.deleteMany({
    where: { tenantId, provider: GOOGLE, purpose },
  });
}

/** Stamp lastSyncedAt after a successful ingestion run. */
export async function touchGoogleLastSynced(
  tenantId: string,
  purpose: GooglePurpose = "MAIN",
): Promise<void> {
  await controlPrisma.integration.updateMany({
    where: { tenantId, provider: GOOGLE, purpose },
    data: { lastSyncedAt: new Date() },
  });
}

// ————— Fireflies —————
// Same Integration row, different provider: the API key is stored encrypted in
// the `refreshToken` column (it's the row's "secret material" slot), and
// `accountEmail` carries the optional owner-email hint used to skip the owner
// among meeting attendees.

/** Public view of the Fireflies connection for the UI (no secret material). */
export interface FirefliesConnection {
  connectedAt: Date;
  lastSyncedAt: Date | null;
}

export async function getFirefliesConnection(
  tenantId: string,
): Promise<FirefliesConnection | null> {
  const row = await controlPrisma.integration.findUnique({
    where: {
      tenantId_provider_purpose: {
        tenantId,
        provider: FIREFLIES,
        purpose: "MAIN",
      },
    },
  });
  if (!row || row.status !== "ACTIVE") return null;
  return { connectedAt: row.connectedAt, lastSyncedAt: row.lastSyncedAt };
}

/** The decrypted Fireflies API key for server-side sync calls, or null. */
export async function getFirefliesKey(tenantId: string): Promise<string | null> {
  const row = await controlPrisma.integration.findUnique({
    where: {
      tenantId_provider_purpose: {
        tenantId,
        provider: FIREFLIES,
        purpose: "MAIN",
      },
    },
  });
  if (!row || row.status !== "ACTIVE") return null;
  return decrypt(row.refreshToken);
}

/** Create or replace the Fireflies connection (encrypts the API key). */
export async function upsertFirefliesIntegration(args: {
  tenantId: string;
  apiKey: string;
}): Promise<void> {
  const data = {
    accountEmail: "",
    refreshToken: encrypt(args.apiKey),
    scopes: [] as string[],
    status: "ACTIVE",
  };
  await controlPrisma.integration.upsert({
    where: {
      tenantId_provider_purpose: {
        tenantId: args.tenantId,
        provider: FIREFLIES,
        purpose: "MAIN",
      },
    },
    update: data,
    create: { tenantId: args.tenantId, provider: FIREFLIES, ...data },
  });
}

/** Remove the Fireflies connection for a tenant. */
export async function deleteFirefliesIntegration(tenantId: string): Promise<void> {
  await controlPrisma.integration.deleteMany({
    where: { tenantId, provider: FIREFLIES },
  });
}

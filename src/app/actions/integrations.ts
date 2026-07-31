"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getGoogleCredential, deleteGoogleIntegration } from "@/lib/integrations";
import { revokeRefreshToken } from "@/lib/google-oauth";

/**
 * Third-party connection management that isn't marketplace-specific.
 *
 * eBay's equivalents live in src/app/actions/chronos-sync.ts because they also
 * drive a sync run; Google only connects and disconnects. Connecting is the
 * OAuth route pair under /api/integrations/google — an action can't redirect a
 * user to a consent screen and come back with a cookie intact.
 *
 * Fireflies used to live here too. It retired with the generic CRM: it ingests
 * sales-call transcripts, which has no place in a buy/restore/resell workflow.
 */

export interface IntegrationResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Disconnect the tenant's mailbox: revoke at Google first, then drop the local
 * row. Order matters — deleting locally first would strand a live grant on the
 * Google account with no way for us to revoke it.
 *
 * Already-ingested activities stay. They are historical fact, and Huginn's
 * drafts cite them as sources.
 */
export async function disconnectGoogleSA(): Promise<IntegrationResult> {
  const session = await requireRole(["ADMIN"]);
  const cred = await getGoogleCredential(session.tenantId);
  if (cred) {
    await revokeRefreshToken(cred.refreshToken);
    await deleteGoogleIntegration(session.tenantId);
  }
  revalidatePath("/chronos/settings");
  return { ok: true, message: "Compte Google déconnecté." };
}

"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { getGoogleCredential, deleteGoogleIntegration } from "@/lib/integrations";
import { revokeRefreshToken } from "@/lib/google-oauth";

/** Disconnect the tenant's Google account: revoke at Google, then delete locally. */
export async function disconnectGoogle(): Promise<void> {
  const session = await verifySession();
  const cred = await getGoogleCredential(session.tenantId);
  if (cred) {
    await revokeRefreshToken(cred.refreshToken);
    await deleteGoogleIntegration(session.tenantId);
  }
  revalidatePath("/dashboard");
}

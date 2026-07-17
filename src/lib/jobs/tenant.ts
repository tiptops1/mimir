import { NonRetriableError } from "inngest";
import { controlPrisma } from "@/lib/control-db";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";

// Jobs are session-less: queue payloads carry IDs only, so every step resolves
// tenantId -> connection through the control plane (never getTenantDb(), which
// is session-scoped). Shared by all Inngest functions.

export async function tenantPrismaById(tenantId: string) {
  const tenant = await controlPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: { connectionString: true },
  });
  if (!tenant) {
    throw new NonRetriableError(`Unknown tenant: ${tenantId}`);
  }
  return getTenantPrisma(decrypt(tenant.connectionString));
}

"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import {
  upsertFirefliesIntegration,
  deleteFirefliesIntegration,
} from "@/lib/integrations";

// Self-serve integration credentials (Phase 3). Google has its own OAuth routes;
// Fireflies is a plain API key the tenant pastes in, stored encrypted in the
// control plane (see src/lib/integrations.ts).

export interface IntegrationResult {
  error?: string;
  ok?: boolean;
}

export async function saveFirefliesKey(
  _prev: IntegrationResult | undefined,
  formData: FormData,
): Promise<IntegrationResult> {
  const session = await requireRole(["ADMIN"]);
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!apiKey) {
    return { error: "La clé API est requise." };
  }
  if (apiKey.length < 10) {
    return { error: "Cette clé semble trop courte pour être une clé Fireflies." };
  }
  await upsertFirefliesIntegration({ tenantId: session.tenantId, apiKey });
  revalidatePath("/settings/integrations");
  return { ok: true };
}

export async function disconnectFireflies(): Promise<IntegrationResult> {
  const session = await requireRole(["ADMIN"]);
  await deleteFirefliesIntegration(session.tenantId);
  revalidatePath("/settings/integrations");
  return { ok: true };
}

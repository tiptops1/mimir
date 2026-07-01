"use server";

import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/dal";
import { isPlatformAdmin } from "@/lib/platform";
import { provisionTenant } from "@/lib/provision";

// Phase 4 self-serve onboarding action — vendor-only (PLATFORM_ADMIN_EMAILS).

export interface PlatformResult {
  error?: string;
  ok?: boolean;
}

export async function createTenant(
  _prev: PlatformResult | undefined,
  formData: FormData,
): Promise<PlatformResult> {
  const session = await verifySession();
  if (!isPlatformAdmin(session.email)) {
    return { error: "Réservé à l'administrateur de la plateforme." };
  }

  const res = await provisionTenant(
    {
      slug: String(formData.get("slug") ?? ""),
      name: String(formData.get("name") ?? ""),
      adminEmail: String(formData.get("adminEmail") ?? ""),
      adminPassword: String(formData.get("adminPassword") ?? ""),
    },
    session.userId,
  );
  if (res.error) return { error: res.error };

  revalidatePath("/settings/tenants");
  return { ok: true };
}

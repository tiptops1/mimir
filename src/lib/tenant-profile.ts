import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { controlPrisma } from "@/lib/control-db";
import { DEFAULT_BRAND_NAME } from "@/lib/brand";
import { hasModule, homePathFor, type TenantModule } from "@/lib/modules";

/**
 * Tenant identity + entitlement, resolved from the control plane.
 *
 * Split from the DB router (src/lib/tenant-context.ts) on purpose: the router
 * hands out a *connection*, this hands out *who the tenant is and what they
 * bought*. Both read the same control row, so `getTenantRecord` below is the
 * single cached lookup they share — adding module gating costs no extra query.
 *
 * Entitlement lives in the control plane, never in the tenant DB: every
 * tenant-DB config store (FieldDefinition, StageDefinition, Setting…) is
 * ADMIN-editable by the customer through a server action, so a tenant DB is the
 * wrong place to record what a tenant is allowed to have.
 */

export interface TenantProfile {
  id: string;
  slug: string;
  /** Legal/display name of the customer, e.g. "Cabinet Durand". */
  name: string;
  /** Product name for this tenant's shell — never null; falls back to the default. */
  brandName: string;
  /** Logo for this tenant's shell, or null to render the text wordmark. */
  brandLogoUrl: string | null;
  modules: string[];
}

/**
 * The raw control row for the session's tenant. Memoized per request so the
 * layout, the router and any page guard all share one query.
 * Internal — it carries the encrypted connectionString; prefer getTenantProfile.
 */
export const getTenantRecord = cache(async () => {
  const session = await verifySession();
  const tenant = await controlPrisma.tenant.findUnique({
    where: { id: session.tenantId },
  });
  if (!tenant || tenant.status !== "ACTIVE") {
    throw new Error(`No active tenant for session (tenantId=${session.tenantId})`);
  }
  return tenant;
});

/** Tenant identity + entitlement, safe to pass into components (no secrets). */
export const getTenantProfile = cache(async (): Promise<TenantProfile> => {
  const t = await getTenantRecord();
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    brandName: t.brandName?.trim() || DEFAULT_BRAND_NAME,
    brandLogoUrl: t.brandLogoUrl?.trim() || null,
    modules: t.modules,
  };
});

/**
 * Guard a page behind a module. Hiding a nav entry is not access control — the
 * route stays reachable by URL — so every module-scoped page calls this.
 * Redirects to the shared home, mirroring `requireRole` in src/lib/dal.ts.
 */
export async function requireModule(mod: TenantModule): Promise<TenantProfile> {
  const profile = await getTenantProfile();
  if (!hasModule(profile.modules, mod)) {
    // The tenant's OWN home, not a fixed path — /dashboard is CRM-gated, so a
    // fixed target would bounce a non-CRM tenant back and forth forever.
    redirect(homePathFor(profile.modules));
  }
  return profile;
}

export { hasModule, homePathFor, type TenantModule } from "@/lib/modules";

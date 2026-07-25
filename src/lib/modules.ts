/**
 * Client-safe half of tenant entitlement. The server half — resolving the
 * tenant's modules from the control plane, and the `requireModule` page guard —
 * is src/lib/tenant-profile.ts, which is "server-only" and therefore cannot be
 * imported by client components like the sidebar. Same split as
 * stage-config.ts / stage-meta.ts.
 */

/**
 * Modules a tenant can be entitled to. The DB column is open-vocab `String[]`,
 * so adding a vertical here is a type change, not a migration.
 *
 * - "core"    — every tenant has it (dashboard, settings, approvals). Never gated.
 * - "crm"     — the inherited CRM: companies, contacts, pipeline, lead-gen, outreach.
 * - "chronos" — the buy/restore/resell inventory vertical (S27+).
 */
export type TenantModule = "core" | "crm" | "chronos";

/** What a tenant gets when nothing else is specified. */
export const DEFAULT_MODULES: TenantModule[] = ["crm"];

/** Is this set of modules entitled to `mod`? "core" is implicit. */
export function hasModule(modules: string[], mod: TenantModule): boolean {
  return mod === "core" || modules.includes(mod);
}

/**
 * Where "home" is for this tenant. /dashboard is the CRM's home — it reads
 * companies, contacts, the stage funnel and the finance cockpit — so a tenant
 * without the CRM must land somewhere else, and redirect targets must agree
 * with the page guards or they loop.
 *
 * Invariant: a tenant always has at least one module (provisioning enforces it),
 * so the final fallback is unreachable in practice.
 */
export function homePathFor(modules: string[]): string {
  if (hasModule(modules, "crm")) return "/dashboard";
  if (hasModule(modules, "chronos")) return "/chronos";
  return "/dashboard";
}

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
 * - "core"    — every tenant has it (settings, approvals). Never gated.
 * - "chronos" — the watch buy/restore/resell trade. The product.
 * - "crm"     — the inherited generic-CRM surfaces (companies, contacts,
 *               pipeline, lead-gen, outreach). RETIRED: no tenant is entitled
 *               to it any more and it appears in no nav. The value is kept in
 *               the union only so the `requireModule("crm")` guards on those
 *               legacy routes keep type-checking while they redirect everyone
 *               away. Do not grant it; do not add surfaces to it.
 */
export type TenantModule = "core" | "crm" | "chronos";

/** What a tenant gets when nothing else is specified. */
export const DEFAULT_MODULES: TenantModule[] = ["chronos"];

/** Is this set of modules entitled to `mod`? "core" is implicit. */
export function hasModule(modules: string[], mod: TenantModule): boolean {
  return mod === "core" || modules.includes(mod);
}

/**
 * Where "home" is for this tenant — the inventory, for anyone with the trade.
 *
 * Redirect targets must agree with the page guards or they loop: /dashboard is
 * a retired CRM surface behind requireModule("crm"), so it can never be a
 * fallback. A tenant with neither module is left at the approvals inbox, which
 * is "core" and therefore always reachable.
 */
export function homePathFor(modules: string[]): string {
  if (hasModule(modules, "chronos")) return "/chronos";
  if (hasModule(modules, "crm")) return "/dashboard";
  return "/heimdallr/inbox";
}

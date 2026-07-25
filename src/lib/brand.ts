/**
 * Client-safe half of the branding config (the server half, which resolves the
 * tenant's own `brandName`, is src/lib/tenant-profile.ts — same split as
 * stage-config.ts / stage-meta.ts).
 *
 * Nothing here touches the DB, so pre-auth surfaces that have no tenant yet
 * (login, register, <title>, the PWA manifest) can still be branded: a
 * single-customer deployment sets NEXT_PUBLIC_BRAND_NAME and every one of them
 * follows. Post-auth, Tenant.brandName wins.
 */

/** Deployment-wide product name. Overridden per tenant by Tenant.brandName. */
export const DEFAULT_BRAND_NAME =
  process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Mimir";

/**
 * One-line product description for <meta> and the PWA manifest. Env-overridable
 * for the same reason as the name: these render pre-auth, and the default is
 * vertical-specific ("courtage en assurance") — wrong for any non-CRM tenant.
 */
export const DEFAULT_BRAND_TAGLINE =
  process.env.NEXT_PUBLIC_BRAND_TAGLINE?.trim() ||
  "CRM de prospection pour le courtage en assurance.";

/**
 * Split a wordmark into a neutral head and an accented tail.
 *
 * The original wordmark was hardcoded as `Mi<span>mir</span>`; splitting at
 * floor(len/2) reproduces that exactly for "Mimir" and generalises to any name
 * ("Chronos" → "Chr" + "onos"). Kept as one function so the wordmark can never
 * drift from the split again — a naive grep for the product name missed this
 * mid-word split during the Vision RM → Mimir rebrand (see C3).
 */
export function splitBrand(name: string): { head: string; tail: string } {
  const clean = name.trim() || DEFAULT_BRAND_NAME;
  const at = Math.floor(clean.length / 2);
  return { head: clean.slice(0, at), tail: clean.slice(at) };
}

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
  process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Chronos";

/**
 * One-line product description for <meta> and the PWA manifest. Env-overridable
 * so a differently-branded deployment can state its own trade without a code
 * change — the default is the watch buy/restore/resell trade this product is for.
 */
export const DEFAULT_BRAND_TAGLINE =
  process.env.NEXT_PUBLIC_BRAND_TAGLINE?.trim() ||
  "Achat, restauration, revente — le poste de pilotage horloger.";

/**
 * Split a wordmark into a neutral head and an accented tail.
 *
 * Splitting at floor(len/2) gives "Chronos" → "Chr" + "onos" and generalises to
 * any tenant's own name. Kept as one function so the wordmark can never drift
 * from the split: a naive grep for the product name has already missed this
 * mid-word split once during an earlier rebrand.
 */
export function splitBrand(name: string): { head: string; tail: string } {
  const clean = name.trim() || DEFAULT_BRAND_NAME;
  const at = Math.floor(clean.length / 2);
  return { head: clean.slice(0, at), tail: clean.slice(at) };
}

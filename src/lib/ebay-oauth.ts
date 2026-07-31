import { getEbayCredential, upsertEbayIntegration } from "@/lib/integrations";

/**
 * eBay OAuth (S29) — structurally the twin of src/lib/google-oauth.ts, but
 * deliberately NOT a copy of it. Four things differ and each one breaks a
 * literal port:
 *
 *  1. The redirect is a registered **RuName**, not a URL. eBay names the
 *     redirect you configure in the developer portal, and that NAME is what
 *     goes in the `redirect_uri` parameter. Passing an actual URL fails.
 *  2. Sandbox and production are separate keysets AND separate hosts.
 *  3. **We own the refresh.** `googleapis` mints access tokens transparently;
 *     nothing does that here. User access tokens last ~2 h and refresh tokens
 *     ~18 months, so this module caches access tokens in-process and refreshes
 *     them before expiry.
 *  4. Production RuName redirects must be public https — localhost is refused.
 *     Local consent therefore needs a tunnel; see docs/mimir/ops.md.
 *
 * No control-plane schema change: the `Integration` row's `refreshToken` column
 * is the generic encrypted-secret slot (Fireflies already stores a bare API key
 * there), so `provider:"ebay"` fits as-is.
 */

/**
 * Read-only Sell scopes. Chronos mirrors his sales; it never lists or sells on
 * his behalf, and there is no path in this codebase that would.
 *
 * The `api.ebay.com` prefix is part of the scope STRING and stays identical in
 * sandbox — it is an identifier, not an endpoint.
 */
export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.finances",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
];

export const EBAY_STATE_COOKIE = "ebay_oauth_state";

export interface EbayHosts {
  auth: string;
  api: string;
}

export function ebayHosts(): EbayHosts {
  const sandbox = (process.env.EBAY_ENV ?? "production").trim().toLowerCase() === "sandbox";
  return sandbox
    ? { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" }
    : { auth: "https://auth.ebay.com", api: "https://api.ebay.com" };
}

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `${name} is not set — the eBay integration is not configured for this environment.`,
    );
  }
  return v;
}

export function ebayConfigured(): boolean {
  return Boolean(
    process.env.EBAY_CLIENT_ID?.trim() &&
      process.env.EBAY_CLIENT_SECRET?.trim() &&
      process.env.EBAY_RUNAME?.trim(),
  );
}

function basicAuthHeader(): string {
  const raw = `${env("EBAY_CLIENT_ID")}:${env("EBAY_CLIENT_SECRET")}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

/** Consent URL. `state` is the CSRF token also stored in an httpOnly cookie. */
export function authUrl(state: string): string {
  const url = new URL("/oauth2/authorize", ebayHosts().auth);
  url.searchParams.set("client_id", env("EBAY_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  // Not a typo: the RuName goes where a URL would.
  url.searchParams.set("redirect_uri", env("EBAY_RUNAME"));
  url.searchParams.set("scope", EBAY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export interface EbayTokenSet {
  accessToken: string;
  /** Absent on a refresh response — eBay only returns it at code exchange. */
  refreshToken?: string;
  expiresInSeconds: number;
}

async function tokenRequest(body: URLSearchParams): Promise<EbayTokenSet> {
  const res = await fetch(`${ebayHosts().api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    // eBay returns a JSON error body; surface it but never the credentials.
    throw new Error(`eBay token request failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const json = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token) {
    throw new Error("eBay token response carried no access_token");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresInSeconds: json.expires_in ?? 7200,
  };
}

/** Exchange the consent code. This is the only place a refresh token appears. */
export async function exchangeCode(code: string): Promise<EbayTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env("EBAY_RUNAME"),
  });
  const tokens = await tokenRequest(body);
  if (!tokens.refreshToken) {
    throw new Error("eBay code exchange returned no refresh_token — cannot persist the connection");
  }
  return tokens;
}

export async function refreshAccessToken(refreshToken: string): Promise<EbayTokenSet> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: EBAY_SCOPES.join(" "),
    }),
  );
}

/**
 * Identify the eBay account behind a token, for display on the settings page.
 * Best-effort: a failure here must not block connecting.
 */
export async function fetchAccountLabel(accessToken: string): Promise<string> {
  try {
    const res = await fetch(`${ebayHosts().api}/sell/account/v1/privilege`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return "";
    const json = (await res.json()) as { sellerRegistrationCompleted?: boolean };
    return json.sellerRegistrationCompleted ? "eBay seller account" : "";
  } catch {
    return "";
  }
}

/** Persist a freshly-exchanged connection. */
export async function saveConnection(args: {
  tenantId: string;
  accountLabel: string;
  refreshToken: string;
}): Promise<void> {
  await upsertEbayIntegration({
    tenantId: args.tenantId,
    accountEmail: args.accountLabel,
    refreshToken: args.refreshToken,
    scopes: EBAY_SCOPES,
  });
  accessTokens.delete(args.tenantId);
}

// ————— Access-token cache —————
// Per-process, keyed by tenant. Serverless instances each keep their own, which
// is fine: the worst case is one extra refresh call per cold start. Persisting
// access tokens would mean writing a short-lived secret to the control plane
// for no benefit.

interface CachedToken {
  token: string;
  expiresAt: number;
}

const globalForEbay = globalThis as unknown as { ebayTokens?: Map<string, CachedToken> };
const accessTokens = globalForEbay.ebayTokens ?? new Map<string, CachedToken>();
if (process.env.NODE_ENV !== "production") globalForEbay.ebayTokens = accessTokens;

/** Refresh this far before actual expiry, so an in-flight call can't age out. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * A usable access token for a tenant, or null when eBay isn't connected.
 * Callers treat null as "no sync this run", exactly like authedClientForTenant.
 */
export async function accessTokenForTenant(tenantId: string): Promise<string | null> {
  const cached = accessTokens.get(tenantId);
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > Date.now()) return cached.token;

  const credential = await getEbayCredential(tenantId);
  if (!credential) return null;

  const tokens = await refreshAccessToken(credential.refreshToken);
  accessTokens.set(tenantId, {
    token: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
  });
  return tokens.accessToken;
}

/** Drop a tenant's cached token — call after disconnecting. */
export function forgetAccessToken(tenantId: string): void {
  accessTokens.delete(tenantId);
}

import { google } from "googleapis";
import { getGoogleCredential, type GooglePurpose } from "@/lib/integrations";

// No "server-only" guard (like crypto.ts / integrations.ts): the session-less
// sync scripts (tsx) reuse these helpers.

// Derive the client type from googleapis itself. Importing GoogleOAuthClient from
// "google-auth-library" picks the top-level copy, which is nominally distinct
// from the nested googleapis-common copy that google.gmail()/calendar() expect.
export type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>;

// Google OAuth 2.0 plumbing. One app registration (the GOOGLE_* env vars) serves
// the platform; each tenant's refresh token is stored encrypted in the control
// plane (src/lib/integrations.ts). googleapis transparently mints short-lived
// access tokens from the refresh token, so callers never persist access tokens.

// Read access matches today's ingestion; write scopes (gmail.send,
// calendar.events) are requested now so enabling send/create later needs no
// re-consent. The actual write FEATURES are a deferred follow-up.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

/** httpOnly cookie name holding the OAuth CSRF `state` between connect → callback. */
export const STATE_COOKIE = "google_oauth_state";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/**
 * A bare OAuth2 client bound to our app credentials + redirect URI.
 *
 * OUTREACH prefers a dedicated OAuth app (GOOGLE_OUTREACH_*): an Internal-consent
 * client owned by the outreach Workspace org has no 7-day refresh-token expiry —
 * the main app is External/Testing, whose weekly token death is unacceptable for
 * an autonomous sender. Falls back to the main app when the vars aren't set.
 */
export function oauthClient(purpose: GooglePurpose = "MAIN"): GoogleOAuthClient {
  if (purpose === "OUTREACH" && process.env.GOOGLE_OUTREACH_CLIENT_ID) {
    return new google.auth.OAuth2(
      env("GOOGLE_OUTREACH_CLIENT_ID"),
      env("GOOGLE_OUTREACH_CLIENT_SECRET"),
      env("GOOGLE_OUTREACH_REDIRECT_URI"),
    );
  }
  return new google.auth.OAuth2(
    env("GOOGLE_CLIENT_ID"),
    env("GOOGLE_CLIENT_SECRET"),
    env("GOOGLE_OAUTH_REDIRECT_URI"),
  );
}

/** The Google consent URL. `state` is the CSRF token echoed back to the callback. */
export function authUrl(state: string, purpose: GooglePurpose = "MAIN"): string {
  return oauthClient(purpose).generateAuthUrl({
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // force the refresh token to be returned every time
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export interface ExchangedCredential {
  refreshToken: string;
  accountEmail: string;
  scopes: string[];
}

/** Exchange the callback `code` for tokens and resolve the connected account. */
export async function exchangeCode(
  code: string,
  purpose: GooglePurpose = "MAIN",
): Promise<ExchangedCredential> {
  const client = oauthClient(purpose);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    // Happens if the user previously consented and Google withholds the refresh
    // token. `prompt=consent` above avoids this; surface a clear error if not.
    throw new Error(
      "Google n'a pas renvoyé de refresh token. Révoquez l'accès de l'app puis reconnectez.",
    );
  }
  client.setCredentials(tokens);
  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const accountEmail = data.email;
  if (!accountEmail) throw new Error("Impossible de lire l'email du compte Google.");
  return {
    refreshToken: tokens.refresh_token,
    accountEmail,
    scopes: tokens.scope ? tokens.scope.split(" ") : GOOGLE_SCOPES,
  };
}

/**
 * An OAuth2 client authorized as the tenant's connected Google account, ready to
 * hand to `google.gmail()` / `google.calendar()`. Returns null if not connected.
 */
export async function authedClientForTenant(
  tenantId: string,
): Promise<{ client: GoogleOAuthClient; accountEmail: string } | null> {
  const cred = await getGoogleCredential(tenantId);
  if (!cred) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: cred.refreshToken });
  return { client, accountEmail: cred.accountEmail };
}

/**
 * Same as authedClientForTenant but for the tenant's OUTREACH connection (the
 * cold-email sender inbox). Null when no outreach account is connected — the
 * send engine treats that as "outreach not configured" and does nothing.
 */
export async function authedClientForOutreach(
  tenantId: string,
): Promise<{ client: GoogleOAuthClient; accountEmail: string } | null> {
  const cred = await getGoogleCredential(tenantId, "OUTREACH");
  if (!cred) return null;
  const client = oauthClient("OUTREACH");
  client.setCredentials({ refresh_token: cred.refreshToken });
  return { client, accountEmail: cred.accountEmail };
}

/** Revoke a refresh token at Google (best-effort; ignores already-revoked). */
export async function revokeRefreshToken(
  refreshToken: string,
  purpose: GooglePurpose = "MAIN",
): Promise<void> {
  try {
    await oauthClient(purpose).revokeToken(refreshToken);
  } catch {
    // Token may already be invalid/revoked — disconnecting locally is what matters.
  }
}

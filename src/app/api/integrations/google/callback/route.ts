import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/dal";
import { exchangeCode, STATE_COOKIE } from "@/lib/google-oauth";
import { upsertGoogleIntegration } from "@/lib/integrations";

// Step 2: Google redirects back here with `code` + `state`. We verify the state
// against the cookie, exchange the code for a refresh token, store it (encrypted)
// against the session's tenant, and return to the dashboard with a status flag.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await verifySession();

  const base = process.env.APP_URL || req.nextUrl.origin;
  const dashboard = new URL("/dashboard", base);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (oauthError || !code || !state || !expected || state !== expected) {
    dashboard.searchParams.set("google", "error");
    return NextResponse.redirect(dashboard);
  }

  try {
    const cred = await exchangeCode(code);
    await upsertGoogleIntegration({
      tenantId: session.tenantId,
      accountEmail: cred.accountEmail,
      refreshToken: cred.refreshToken,
      scopes: cred.scopes,
    });
    dashboard.searchParams.set("google", "connected");
  } catch (e) {
    console.error("Google OAuth callback failed:", e);
    dashboard.searchParams.set("google", "error");
  }

  return NextResponse.redirect(dashboard);
}

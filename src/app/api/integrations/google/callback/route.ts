import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/dal";
import { exchangeCode, STATE_COOKIE } from "@/lib/google-oauth";
import { upsertGoogleIntegration, type GooglePurpose } from "@/lib/integrations";

// Step 2: Google redirects back here with `code` + `state`. We verify the state
// against the cookie, exchange the code for a refresh token, store it (encrypted)
// against the session's tenant, and return with a status flag. The state's
// ":<purpose>" suffix (set by the connect route) decides which connection slot
// the account lands in — MAIN goes back to /dashboard, OUTREACH to
// /settings/integrations where its card lives.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await verifySession();

  const base = process.env.APP_URL || req.nextUrl.origin;

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  const purpose: GooglePurpose =
    expected?.endsWith(":OUTREACH") === true ? "OUTREACH" : "MAIN";
  const back = new URL(
    purpose === "OUTREACH" ? "/settings/integrations" : "/dashboard",
    base,
  );
  const flag = purpose === "OUTREACH" ? "outreach" : "google";

  if (oauthError || !code || !state || !expected || state !== expected) {
    back.searchParams.set(flag, "error");
    return NextResponse.redirect(back);
  }

  try {
    const cred = await exchangeCode(code, purpose);
    await upsertGoogleIntegration({
      tenantId: session.tenantId,
      accountEmail: cred.accountEmail,
      refreshToken: cred.refreshToken,
      scopes: cred.scopes,
      purpose,
    });
    back.searchParams.set(flag, "connected");
  } catch (e) {
    console.error("Google OAuth callback failed:", e);
    back.searchParams.set(flag, "error");
  }

  return NextResponse.redirect(back);
}

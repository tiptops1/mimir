import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/dal";
import { requireModule } from "@/lib/tenant-profile";
import {
  EBAY_STATE_COOKIE,
  exchangeCode,
  fetchAccountLabel,
  saveConnection,
} from "@/lib/ebay-oauth";

// Step 2: eBay redirects back here with `code` + `state`. Verify state against
// the cookie, exchange the code for a refresh token, store it encrypted against
// the session's tenant.
//
// Note this route's URL must be the one registered under the RuName in the eBay
// developer portal — eBay redirects to the RuName's configured URL, not to a
// `redirect_uri` we send. In production that URL must be public https, so
// exercising this locally needs a tunnel (docs/chronos/ops.md).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await verifySession();
  await requireModule("chronos");

  const back = new URL("/chronos/settings", req.nextUrl.origin);

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  // eBay reports a refusal as `error_description`, unlike Google's `error`.
  const refused =
    req.nextUrl.searchParams.get("error") ??
    req.nextUrl.searchParams.get("error_description");

  const cookieStore = await cookies();
  const expected = cookieStore.get(EBAY_STATE_COOKIE)?.value;
  cookieStore.delete(EBAY_STATE_COOKIE);

  if (refused || !code || !state || !expected || state !== expected) {
    back.searchParams.set("ebay", "error");
    return NextResponse.redirect(back);
  }

  try {
    const tokens = await exchangeCode(code);
    const label = await fetchAccountLabel(tokens.accessToken);
    await saveConnection({
      tenantId: session.tenantId,
      accountLabel: label || "eBay",
      // exchangeCode throws if this is absent, so the cast is safe here.
      refreshToken: tokens.refreshToken as string,
    });
    back.searchParams.set("ebay", "connected");
  } catch (e) {
    console.error("eBay OAuth callback failed:", e);
    back.searchParams.set("ebay", "error");
  }

  return NextResponse.redirect(back);
}

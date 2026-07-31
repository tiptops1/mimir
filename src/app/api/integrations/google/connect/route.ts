import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/dal";
import { authUrl, STATE_COOKIE } from "@/lib/google-oauth";

// Step 1 of the Google connect flow: from /chronos/settings, the user follows
// this link. We require a logged-in (tenant-scoped) session, mint a CSRF
// `state`, stash it in an httpOnly cookie, and bounce to Google's consent
// screen.
//
// MAIN only. The route used to accept `?purpose=OUTREACH` to provision the
// cold-email sender inbox on a secondary domain; that surface retired with the
// generic CRM, so the branch would be unreachable. `authedClientForOutreach`
// still resolves an existing OUTREACH row — this only stops new ones being
// created from the UI.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await verifySession(); // redirects to /login if not authenticated

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });

  return NextResponse.redirect(authUrl(state, "MAIN"));
}

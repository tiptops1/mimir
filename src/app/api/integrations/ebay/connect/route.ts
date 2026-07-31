import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { verifySession } from "@/lib/dal";
import { requireModule } from "@/lib/tenant-profile";
import { EBAY_STATE_COOKIE, authUrl, ebayConfigured } from "@/lib/ebay-oauth";
import { appUrl } from "@/lib/app-url";

// Step 1 of the eBay connect flow (S29), mirroring the Google connect route:
// require a tenant-scoped session, mint a CSRF `state`, stash it in an httpOnly
// cookie, bounce to eBay's consent screen. Additionally module-gated — eBay is
// a Chronos capability, and hiding a nav link is not access control.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await verifySession();
  await requireModule("chronos");

  if (!ebayConfigured()) {
    const back = new URL("/chronos/settings", appUrl());
    back.searchParams.set("ebay", "unconfigured");
    return NextResponse.redirect(back);
  }

  const state = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(EBAY_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });

  return NextResponse.redirect(authUrl(state));
}

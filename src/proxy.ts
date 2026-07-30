import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Optimistic auth gate. Real authorization happens in the Data Access Layer
// (src/lib/dal.ts) and in each Server Action / Route Handler.

const PUBLIC_ROUTES = ["/login", "/register"];

/**
 * Mirrors src/lib/session.ts's signingKey(). Encoding an absent SESSION_SECRET
 * yields a key that verifies nothing, so every visitor is silently redirected to
 * /login with no error anywhere — indistinguishable from "everyone is logged
 * out". Fail loudly instead: a 500 with this message is diagnosable.
 */
function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set — the auth gate cannot verify sessions. " +
        "Set it in this environment (see .env.example) before serving traffic.",
    );
  }
  return new TextEncoder().encode(secret);
}

async function isAuthenticated(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const key = signingKey();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    // A pre-multi-tenant token has no tenantId — treat it as unauthenticated so
    // stale sessions are forced to re-login (and don't loop /login ↔ /dashboard).
    return typeof payload.tenantId === "string" && payload.tenantId.length > 0;
  } catch {
    return false;
  }
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const authed = await isAuthenticated(req.cookies.get("session")?.value);

  if (!authed && !isPublic) {
    const url = new URL("/login", req.nextUrl);
    return NextResponse.redirect(url);
  }
  if (authed && isPublic) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};

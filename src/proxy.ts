import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Optimistic auth gate. Real authorization happens in the Data Access Layer
// (src/lib/dal.ts) and in each Server Action / Route Handler.

const PUBLIC_ROUTES = ["/login", "/register"];
const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET);

async function isAuthenticated(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    return true;
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

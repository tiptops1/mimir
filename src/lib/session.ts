import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export interface SessionPayload {
  userId: string;
  /** Active tenant for this session — drives the DB router (see tenant-context.ts). */
  tenantId: string;
  /** Role within the active tenant (sourced from the Membership). */
  role: "ADMIN" | "MANAGER" | "USER";
  name: string;
  email: string;
  [key: string]: unknown;
}

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Signing key for session JWTs.
 *
 * Resolved per call, and it THROWS when SESSION_SECRET is absent. It used to be
 * `new TextEncoder().encode(process.env.SESSION_SECRET)` at module load, which
 * silently encodes `undefined` into a valid-looking key: every sign succeeds,
 * every verify fails, and the only symptom is that the whole app bounces
 * everyone to /login with nothing in the logs. That is a plausible first day on
 * a fresh Vercel project, so it must be loud (see docs/mimir/ops.md).
 */
function signingKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set — session JWTs cannot be signed or verified. " +
        "Set it in this environment (see .env.example) before serving traffic.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(signingKey());
}

export async function decrypt(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      algorithms: ["HS256"],
    });
    return payload as SessionPayload;
  } catch (e) {
    // A misconfigured environment must not masquerade as a bad token.
    if (e instanceof Error && e.message.startsWith("SESSION_SECRET")) throw e;
    return null;
  }
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await encrypt(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return decrypt(token);
}

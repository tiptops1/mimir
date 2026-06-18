import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession, type SessionPayload } from "@/lib/session";

/**
 * Verify the current session. Redirects to /login if absent.
 * Memoized per-request via React cache.
 */
export const verifySession = cache(async (): Promise<SessionPayload> => {
  const session = await getSession();
  if (!session?.userId) {
    redirect("/login");
  }
  return session;
});

/** Like verifySession but returns null instead of redirecting. */
export const getOptionalSession = cache(
  async (): Promise<SessionPayload | null> => {
    return getSession();
  },
);

/** Ensure the user has one of the allowed roles, else redirect to /dashboard. */
export async function requireRole(
  roles: Array<SessionPayload["role"]>,
): Promise<SessionPayload> {
  const session = await verifySession();
  if (!roles.includes(session.role)) {
    redirect("/dashboard");
  }
  return session;
}

import type { NextRequest } from "next/server";

/**
 * Shared gate for externally-triggered routes (/api/cron/*, /api/jobs/*).
 * Accepts `Authorization: Bearer $CRON_SECRET` (the cron-job.org convention)
 * or `?key=$CRON_SECRET`. Fails closed if CRON_SECRET is not configured.
 */
export function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("key") === secret;
}

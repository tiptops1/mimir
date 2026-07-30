import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { isProd } from "@/lib/env-identity";

/**
 * Shared gate for externally-triggered routes (/api/cron/*, /api/jobs/*).
 * Accepts `Authorization: Bearer $CRON_SECRET` (the cron-job.org convention).
 * Fails closed if CRON_SECRET is not configured.
 *
 * S28 hardening, both changes driven by a real cluster now existing:
 *
 * 1. The comparison is timing-safe. A plain `===` on a secret leaks its prefix
 *    to anyone who can measure response time, and these routes are public.
 * 2. The `?key=$CRON_SECRET` fallback is DISABLED in production. It was a
 *    convenience for cron schedulers that can't set headers; the cost is the
 *    secret landing in cron-job.org's stored URL, in Vercel's access logs, and
 *    in any proxy in between. cron-job.org supports custom headers, so the
 *    Bearer form is always available — see docs/mimir/ops.md.
 */
export function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = req.headers.get("authorization");
  if (auth && secretEquals(auth, `Bearer ${secret}`)) return true;

  if (isProd()) return false;

  const key = req.nextUrl.searchParams.get("key");
  return key !== null && secretEquals(key, secret);
}

function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which is itself a (harmless)
  // length oracle — the secret's length is not the part worth protecting.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

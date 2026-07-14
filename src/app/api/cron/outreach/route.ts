import { NextResponse, type NextRequest } from "next/server";
import { listActiveTenants, settle } from "@/lib/tenant-cron";
import { runOutreachForTenant } from "@/lib/outreach";

// Outreach scheduler entry point — separate from /api/cron (4h ingestion) so
// cold-email pacing gets its own cadence. Schedule on cron-job.org:
//   hourly, Mon-Fri, 08:00-18:00 Europe/Paris
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/outreach
// The engine re-checks business day / window / caps itself — a stray weekend
// hit does nothing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("key") === secret;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listActiveTenants();
  const results = [];
  for (const tenant of tenants) {
    const r = await settle(tenant.slug, () => runOutreachForTenant(tenant));
    results.push(r.ok ? r.result : { tenant: tenant.slug, error: r.error });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenants: results,
  });
}

export const GET = handle;
export const POST = handle;

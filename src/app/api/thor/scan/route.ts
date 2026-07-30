import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { requireTenantParam } from "@/lib/route-tenant";

// S22b — Thor renewal scan trigger (bragi/scan twin). Enqueues one health
// re-evaluation sweep for the tenant; at-risk/critical companies fan out
// draft jobs. Own cadence/trigger route, not chained from the daily
// /api/cron/thor snapshot — same posture as every other module's trigger.
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/thor/scan?tenant=crm_demo"

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!jobsEnabled()) {
    return NextResponse.json(
      { error: "Jobs disabled (no INNGEST_SIGNING_KEY / INNGEST_DEV)" },
      { status: 503 },
    );
  }

  const lookup = await requireTenantParam(req);
  if (!lookup.ok) return lookup.response;
  const { tenant } = lookup;

  const { ids } = await inngest.send({
    name: "thor/renewal.scan.requested",
    data: { tenantId: tenant.id },
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: tenant.slug,
    mode: "scan",
    eventIds: ids,
  });
}

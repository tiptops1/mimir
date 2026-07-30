import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { requireTenantParam } from "@/lib/route-tenant";

// S25 — Freyja decision-scan trigger (thor/scan twin). Aggregates trailing
// insight per campaign, flags candidates, fans out one decision job each.
// Own cadence/trigger route, not chained from the daily /api/cron/freyja
// metrics pull — same posture as every other module's trigger.
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/freyja/scan?tenant=crm_demo"

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
    name: "freyja/campaign.scan.requested",
    data: { tenantId: tenant.id },
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: tenant.slug,
    mode: "scan",
    eventIds: ids,
  });
}

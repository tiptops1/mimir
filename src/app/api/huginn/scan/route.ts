import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { requireTenantParam } from "@/lib/route-tenant";

// S14b — Huginn scan trigger (proof-route pattern, mimisbrunnr/ingest twin).
// Enqueues one inbox scan for a tenant; the scan fans out draft jobs for
// unprocessed inbound emails. Manual dev trigger + prod escape hatch:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/huginn/scan?tenant=crm_demo"

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
    name: "huginn/inbox.scan.requested",
    data: { tenantId: tenant.id },
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: tenant.slug,
    eventIds: ids,
  });
}

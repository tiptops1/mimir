import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { requireTenantParam } from "@/lib/route-tenant";

// S18 — Bragi scan trigger (huginn/scan twin). Without ?slot, enqueues one
// calendar sweep for the tenant (due slots fan out generation jobs;
// cron-wirable later). With ?slot=<id>, force-generates that one slot now —
// the job computes the current period itself and bypasses the period marker
// (that's how you regenerate after a rejection or a brief edit).
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/bragi/scan?tenant=crm_demo[&slot=<id>]"

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

  const slotId = req.nextUrl.searchParams.get("slot");
  const { ids } = await inngest.send(
    slotId
      ? {
          name: "bragi/content.generate.requested",
          data: { tenantId: tenant.id, slotId },
        }
      : {
          name: "bragi/calendar.scan.requested",
          data: { tenantId: tenant.id },
        },
  );

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: tenant.slug,
    mode: slotId ? "generate" : "scan",
    eventIds: ids,
  });
}

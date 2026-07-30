import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { requireTenantParam } from "@/lib/route-tenant";

// S4 proof-job trigger — the cron-job.org-style external entry point:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/jobs/proof?failOnce=1"
// Query params: tenant (slug, REQUIRED since S28), failOnce=1, failAlways=1.

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
    name: "system/proof.requested",
    data: {
      tenantId: tenant.id,
      failOnce: req.nextUrl.searchParams.get("failOnce") === "1",
      failAlways: req.nextUrl.searchParams.get("failAlways") === "1",
    },
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: tenant.slug,
    eventIds: ids,
  });
}

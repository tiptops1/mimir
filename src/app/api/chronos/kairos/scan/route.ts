import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { requireTenantParam } from "@/lib/route-tenant";

// S32 — Kairos sourcing scan trigger (thor/scan twin). Enqueues one watchlist
// sweep: every active SourcingWatch is searched on the marketplace, listings are
// scored against the reference's SOLD band, and true candidates fan out
// evaluation jobs that end in a PROPOSED ledger action.
//
// Nothing downstream of this route buys anything. Approval records a bid
// ceiling for a human; there is no code path in this repo that places a bid.
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/chronos/kairos/scan?tenant=chronos_demo"

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
    name: "kairos/sourcing.scan.requested",
    data: { tenantId: tenant.id },
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: tenant.slug,
    mode: "scan",
    eventIds: ids,
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { controlPrisma } from "@/lib/control-db";

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

  const slug = req.nextUrl.searchParams.get("tenant") ?? "crm_demo";
  const tenant = await controlPrisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: `Unknown tenant: ${slug}` }, { status: 404 });
  }

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

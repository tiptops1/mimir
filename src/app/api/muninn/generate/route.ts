import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { controlPrisma } from "@/lib/control-db";

// S16 — Muninn RCA generation trigger (mirrors /api/huginn/scan). Manually
// triggered per Activity — no ticket/incident model exists to sweep, unlike
// Huginn's inbox scan. Manual dev trigger + prod escape hatch until a UI
// button exists:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/muninn/generate?tenant=crm_demo&activity=<id>"

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
  const activityId = req.nextUrl.searchParams.get("activity");
  if (!activityId) {
    return NextResponse.json({ error: "Missing ?activity=<id>" }, { status: 400 });
  }

  const tenant = await controlPrisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: `Unknown tenant: ${slug}` }, { status: 404 });
  }

  const { ids } = await inngest.send({
    name: "muninn/rca.draft.requested",
    data: { tenantId: tenant.id, activityId },
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: tenant.slug,
    activityId,
    eventIds: ids,
  });
}

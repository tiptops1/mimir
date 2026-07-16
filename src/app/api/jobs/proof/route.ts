import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { controlPrisma } from "@/lib/control-db";

// S4 proof-job trigger — the cron-job.org-style external entry point:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/jobs/proof?failOnce=1"
// Query params: tenant (slug, default crm_demo), failOnce=1, failAlways=1.

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

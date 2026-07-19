import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { controlPrisma } from "@/lib/control-db";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { reviewAndProposeDirective } from "@/lib/odin/review";

// Odin scheduler entry point (S21, odin.md §5) — daily review, plain function
// call, no Inngest (a single Sonnet synthesis over aggregates that already
// exist, not a multi-step pipeline). ?tenant= slug lookup like the manual
// bragi/muninn trigger routes (default crm_demo — Mimir has one demo tenant
// today; loop-all-ACTIVE-tenants, Forseti's shape, is the natural extension
// once a second tenant exists). Schedule on cron-job.org:
//   daily, 04:00 Europe/Paris
//   curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/cron/odin?tenant=crm_demo"

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = req.nextUrl.searchParams.get("tenant") ?? "crm_demo";
  const tenant = await controlPrisma.tenant.findUnique({
    where: { slug },
    select: { connectionString: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: `Unknown tenant: ${slug}` }, { status: 404 });
  }

  const prisma = getTenantPrisma(decrypt(tenant.connectionString));
  const result = await reviewAndProposeDirective(prisma);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: slug,
    ...result,
  });
}

export const GET = handle;
export const POST = handle;

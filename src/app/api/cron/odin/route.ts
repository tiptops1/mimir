import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { listActiveTenants, settle } from "@/lib/tenant-cron";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { reviewAndProposeDirective } from "@/lib/odin/review";

// Odin scheduler entry point (S21, odin.md §5) — daily review, plain function
// call, no Inngest (a single Sonnet synthesis over aggregates that already
// exist, not a multi-step pipeline).
//
// S28: loops every ACTIVE tenant, Forseti's shape. It used to take ?tenant=
// with a `crm_demo` default — the extension S21 itself named as "natural once a
// second tenant exists". A second tenant now exists, and a scheduled route that
// silently reviews one hardcoded tenant is worse than one that reviews none.
// Schedule on cron-job.org:
//   daily, 04:00 Europe/Paris
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/odin

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listActiveTenants();
  const results = [];
  for (const tenant of tenants) {
    const prisma = getTenantPrisma(decrypt(tenant.connectionString));
    const r = await settle(tenant.slug, () => reviewAndProposeDirective(prisma));
    results.push(r.ok ? { tenant: tenant.slug, ...(r.result as object) } : { tenant: tenant.slug, error: r.error });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenants: results,
  });
}

export const GET = handle;
export const POST = handle;

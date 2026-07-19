import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { listActiveTenants, settle } from "@/lib/tenant-cron";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { runHealthSnapshotForTenant } from "@/lib/thor/snapshot";

// Thor scheduler entry point (S22a) — daily account-health sweep, no
// business-hours constraint (unlike outreach). Schedule on cron-job.org:
//   daily, 04:00 Europe/Paris
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/thor

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
    const r = await settle(tenant.slug, () => runHealthSnapshotForTenant(prisma));
    results.push(r.ok ? r.result : { tenant: tenant.slug, error: r.error });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenants: results,
  });
}

export const GET = handle;
export const POST = handle;

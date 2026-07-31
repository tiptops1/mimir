import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { listActiveTenants, settle } from "@/lib/tenant-cron";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { runArgusForTenant } from "@/lib/chronos/argus";

// Argus scheduler entry point (S30) — daily market sweep, mirroring
// /api/cron/forseti and /api/cron/thor exactly. Schedule on cron-job.org:
//   daily, 04:00 Europe/Paris  (after Forseti's 03:00, so the two don't
//   contend for the same M0 cluster)
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/argus
//
// Loops every ACTIVE tenant rather than defaulting to a slug — the S28 rule.
// A tenant with no ProductRefs returns `skipped` and costs one query.

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
    const r = await settle(tenant.slug, () =>
      runArgusForTenant(prisma, { tenantId: tenant.id }),
    );
    results.push(r.ok ? r.result : { tenant: tenant.slug, error: r.error });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenants: results,
  });
}

export const GET = handle;
export const POST = handle;

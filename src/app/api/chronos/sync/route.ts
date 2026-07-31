import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { requireTenantParam } from "@/lib/route-tenant";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { runChronosSyncForTenant } from "@/lib/chronos/sync";
import { touchEbayLastSynced } from "@/lib/integrations";

// S29 — manual Chronos sync trigger, the per-tenant twin of /api/cron/chronos.
// ?tenant= is REQUIRED (S28): a trigger that guesses which tenant it acts on is
// a production hazard.
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<app>/api/chronos/sync?tenant=chronos&days=30"

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lookup = await requireTenantParam(req);
  if (!lookup.ok) return lookup.response;
  const { tenant } = lookup;

  const rawDays = Number(req.nextUrl.searchParams.get("days"));
  const sinceDays = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 365) : undefined;

  const prisma = getTenantPrisma(decrypt(tenant.connectionString));
  const result = await runChronosSyncForTenant(prisma, { tenantId: tenant.id, sinceDays });
  if (result.ordersSeen > 0) await touchEbayLastSynced(tenant.id);

  return NextResponse.json({ ranAt: new Date().toISOString(), tenant: tenant.slug, ...result });
}

export const GET = handle;
export const POST = handle;

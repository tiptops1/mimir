import { NextResponse, type NextRequest } from "next/server";
import { authorized } from "@/lib/cron-auth";
import { listActiveTenants, settle } from "@/lib/tenant-cron";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { runChronosSyncForTenant } from "@/lib/chronos/sync";
import { touchEbayLastSynced } from "@/lib/integrations";

// Chronos marketplace sync (S29) — daily pull of the seller's own orders and
// their real fee lines. Synchronous, no LLM, no Inngest (forseti/freyja shape).
// Schedule on cron-job.org:
//   daily, 06:00 Europe/Paris
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/chronos
//
// Loops every ACTIVE tenant. A tenant without the chronos module, or without
// eBay connected, simply syncs nothing — the same posture as a tenant with no
// Google connection in /api/cron.

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
    const r = await settle(tenant.slug, async () => {
      const result = await runChronosSyncForTenant(prisma, { tenantId: tenant.id });
      if (result.ordersSeen > 0) await touchEbayLastSynced(tenant.id);
      return result;
    });
    results.push(r.ok ? { tenant: tenant.slug, ...(r.result as object) } : { tenant: tenant.slug, error: r.error });
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), tenants: results });
}

export const GET = handle;
export const POST = handle;

import { NextResponse, type NextRequest } from "next/server";
import {
  listActiveTenants,
  runCronForTenant,
  settle,
} from "@/lib/tenant-cron";

// Scheduled entry point: for EVERY active tenant, pull from its connected
// sources, then run the AI insight pass, sequences, finance alerts and the
// daily digest. Hit it from any external scheduler:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron
//
// Phase 3: ingestion is routed per tenant through the control plane
// (src/lib/tenant-cron.ts). Each tenant — and each source within a tenant — is
// isolated so one failure (or a missing credential) can't block the others.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("key") === secret;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listActiveTenants();
  const results = [];
  for (const tenant of tenants) {
    // Sequential on purpose: tenants share the AI-provider rate limit and the
    // Node process; a failed tenant is reported, not thrown.
    const r = await settle(tenant.slug, () => runCronForTenant(tenant));
    results.push(r.ok ? r.result : { tenant: tenant.slug, error: r.error });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenants: results,
  });
}

export const GET = handle;
export const POST = handle;

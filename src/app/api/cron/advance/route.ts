import { NextResponse, type NextRequest } from "next/server";
import { listActiveTenants, settle } from "@/lib/tenant-cron";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { authedClientForTenant } from "@/lib/google-oauth";
import { advanceSequences } from "@/lib/sequences";
import { advanceFinanceAlerts } from "@/lib/finance-alerts";
import { sendDailyDigest } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("key") === secret;
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || email
  );
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listActiveTenants();
  const results = [];

  for (const tenant of tenants) {
    const prisma = getTenantPrisma(decrypt(tenant.connectionString));
    const google = await authedClientForTenant(tenant.id);

    const sequences = await settle("sequences", () =>
      advanceSequences(prisma),
    );
    const financeAlerts = await settle("finance-alerts", () =>
      advanceFinanceAlerts(prisma),
    );
    const digest = await settle("digest", () =>
      sendDailyDigest(prisma, {
        google,
        ownerName: google ? nameFromEmail(google.accountEmail) : undefined,
      }),
    );

    results.push({
      tenant: tenant.slug,
      sequences,
      financeAlerts,
      digest,
    });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenants: results,
  });
}

export const GET = handle;
export const POST = handle;

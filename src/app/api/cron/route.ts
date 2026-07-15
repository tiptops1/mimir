import { NextResponse, type NextRequest } from "next/server";
import { listActiveTenants, settle } from "@/lib/tenant-cron";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { authedClientForTenant } from "@/lib/google-oauth";
import { getFirefliesKey, touchGoogleLastSynced } from "@/lib/integrations";
import { runGmailSync } from "@/lib/gmail-sync";
import { runGoogleCalendarSync } from "@/lib/google-calendar-sync";
import { syncFireflies } from "@/lib/fireflies";
import type { SourceOutcome } from "@/lib/tenant-cron";

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

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await listActiveTenants();
  const results = [];

  for (const tenant of tenants) {
    const prisma = getTenantPrisma(decrypt(tenant.connectionString));
    const google = await authedClientForTenant(tenant.id);

    const sources: SourceOutcome[] = [];

    if (google) {
      sources.push(
        await settle("email", () =>
          runGmailSync(prisma, google.client, google.accountEmail, {}),
        ),
        await settle("calendar", () =>
          runGoogleCalendarSync(prisma, google.client, google.accountEmail, {}),
        ),
      );
    } else {
      sources.push(
        { source: "email", ok: false, error: "Google non connecté" },
        { source: "calendar", ok: false, error: "Google non connecté" },
      );
    }

    const firefliesKey = await getFirefliesKey(tenant.id);
    sources.push(
      firefliesKey
        ? await settle("fireflies", () =>
            syncFireflies(prisma, {
              apiKey: firefliesKey,
              ownerEmail: google?.accountEmail,
            }),
          )
        : {
            source: "fireflies",
            ok: false,
            error: "Clé Fireflies non configurée",
          },
    );

    if (google) await touchGoogleLastSynced(tenant.id);

    results.push({ tenant: tenant.slug, sources });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenants: results,
  });
}

export const GET = handle;
export const POST = handle;

import { NextResponse, type NextRequest } from "next/server";
import { getTenant1Prisma } from "@/lib/tenant-db";
import { runImapSync } from "@/lib/imap-sync";
import { runGmailSync } from "@/lib/gmail-sync";
import { syncCalendar } from "@/lib/calendar-sync";
import { runGoogleCalendarSync } from "@/lib/google-calendar-sync";
import { resolveTenant1Google } from "@/lib/google-oauth";
import { touchGoogleLastSynced } from "@/lib/integrations";
import { syncFireflies } from "@/lib/fireflies";
import { enrichActivities, aiEnabled } from "@/lib/ai-extract";
import { advanceSequences } from "@/lib/sequences";

// Scheduled entry point: pull from every connected source, then run the Claude
// insight pass once. Hit it from Railway's cron (or any external scheduler):
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron
//
// Each source is isolated so one failure (or a missing key) can't block the
// others. Long-running but fine on Railway (the app is a persistent Node server).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function settle<T>(label: string, fn: () => Promise<T>) {
  try {
    return { source: label, ok: true, result: await fn() };
  } catch (e) {
    return { source: label, ok: false, error: (e as Error).message };
  }
}

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

  // Phase 0: ingestion is single-tenant (tenant #1). Phase 3 routes per tenant.
  const prisma = getTenant1Prisma();

  // Prefer the OAuth Google connection if tenant #1 has connected one; otherwise
  // fall back to the legacy IMAP/ICS env config so the live app never goes dark
  // before Christopher clicks Connect.
  const google = await resolveTenant1Google();

  const sources = [
    google
      ? await settle("email", () =>
          runGmailSync(prisma, google.client, google.accountEmail, {}),
        )
      : await settle("email", () => runImapSync(prisma, {})),
    google
      ? await settle("calendar", () =>
          runGoogleCalendarSync(prisma, google.client, google.accountEmail, {}),
        )
      : await settle("calendar", () => syncCalendar(prisma, {})),
    await settle("fireflies", () => syncFireflies(prisma, {})),
  ];

  if (google) await touchGoogleLastSynced(google.tenantId);

  const ai = aiEnabled()
    ? await settle("ai-insight", () => enrichActivities(prisma, { limit: 80 }))
    : { source: "ai-insight", ok: false, error: "no GEMINI_API_KEY or ANTHROPIC_API_KEY" };

  // Materialize any due sequence steps into the task worklist.
  const sequences = await settle("sequences", () => advanceSequences(prisma));

  return NextResponse.json({ ranAt: new Date().toISOString(), sources, ai, sequences });
}

export const GET = handle;
export const POST = handle;

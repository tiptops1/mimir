import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { runImapSync } from "@/lib/imap-sync";
import { syncCalendar } from "@/lib/calendar-sync";
import { syncFireflies } from "@/lib/fireflies";
import { enrichActivities, aiEnabled } from "@/lib/ai-extract";

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

  const sources = [
    await settle("email", () => runImapSync(prisma, {})),
    await settle("calendar", () => syncCalendar(prisma, {})),
    await settle("fireflies", () => syncFireflies(prisma, {})),
  ];

  const ai = aiEnabled()
    ? await settle("ai-insight", () => enrichActivities(prisma, { limit: 80 }))
    : { source: "ai-insight", ok: false, error: "ANTHROPIC_API_KEY not set" };

  return NextResponse.json({ ranAt: new Date().toISOString(), sources, ai });
}

export const GET = handle;
export const POST = handle;

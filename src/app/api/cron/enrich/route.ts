import { NextResponse, type NextRequest } from "next/server";
import { listActiveTenants, settle } from "@/lib/tenant-cron";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { enrichActivities, aiEnabled } from "@/lib/ai-extract";

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

    const ai = aiEnabled()
      ? await settle("ai-insight", () =>
          enrichActivities(prisma, { limit: 20 }),
        )
      : {
          source: "ai-insight",
          ok: false,
          error: "no GEMINI_API_KEY or ANTHROPIC_API_KEY",
        };

    results.push({ tenant: tenant.slug, ai });
  }

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenants: results,
  });
}

export const GET = handle;
export const POST = handle;

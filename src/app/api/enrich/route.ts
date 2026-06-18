import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getOptionalSession } from "@/lib/dal";
import { enrichCompany } from "@/lib/enrich";

/**
 * Enrich a single company from the official French open company API
 * (recherche-entreprises.api.gouv.fr). Body: { companyId }.
 *
 * Bulk enrichment of all companies is done with `npm run enrich:all`
 * (avoids long-running serverless requests).
 */
export async function POST(req: NextRequest) {
  const session = await getOptionalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    companyId?: string;
  } | null;
  if (!body?.companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  try {
    const result = await enrichCompany(prisma, body.companyId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "enrichment_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}

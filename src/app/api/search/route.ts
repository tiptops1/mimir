import { NextResponse, type NextRequest } from "next/server";
import { getOptionalSession } from "@/lib/dal";
import { searchAll } from "@/lib/search";

/**
 * Global search endpoint for the top-bar search box.
 * GET /api/search?q=... → { results: SearchHit[] }
 */
export async function GET(req: NextRequest) {
  const session = await getOptionalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await searchAll(q);
  return NextResponse.json({ results });
}

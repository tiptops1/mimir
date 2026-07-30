import { NextResponse, type NextRequest } from "next/server";
import { controlPrisma } from "@/lib/control-db";

/**
 * Resolve `?tenant=<slug>` for an externally-triggered route.
 *
 * Every scan/trigger route used to read
 *   `searchParams.get("tenant") ?? "crm_demo"`
 * which was harmless while `crm_demo` was the only tenant that existed. In a
 * production environment it is a live hazard: a cron entry that loses its query
 * string silently operates on whatever tenant happens to carry that slug rather
 * than failing. The slug is now REQUIRED — an unaddressed trigger is a
 * configuration error, and configuration errors should be loud.
 *
 * Returns either the resolved tenant or the NextResponse to return verbatim.
 */
export type TenantLookup<T> =
  | { ok: true; tenant: T }
  | { ok: false; response: NextResponse };

export async function requireTenantParam(
  req: NextRequest,
): Promise<TenantLookup<{ id: string; slug: string; connectionString: string }>> {
  const slug = req.nextUrl.searchParams.get("tenant")?.trim();
  if (!slug) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Missing ?tenant=<slug>. This route acts on one tenant and will not " +
            "guess which; name it explicitly.",
        },
        { status: 400 },
      ),
    };
  }

  const tenant = await controlPrisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, connectionString: true },
  });
  if (!tenant) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Unknown tenant: ${slug}` }, { status: 404 }),
    };
  }

  return { ok: true, tenant };
}

import { NextResponse } from "next/server";
import { getOptionalSession } from "@/lib/dal";

/**
 * Enrichment endpoint (placeholder).
 *
 * The CRM imports the source spreadsheet "as-is". Data enrichment (filling in
 * company names, websites, director details, etc.) is intended to be wired up
 * later — e.g. via the official French open API
 * (https://recherche-entreprises.api.gouv.fr) keyed by SIREN/SIRET, or a custom
 * scraping pipeline. Plug that logic in here.
 */
export async function POST() {
  const session = await getOptionalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    {
      error: "not_configured",
      message:
        "L'enrichissement automatique n'est pas encore configuré. Branchez ici l'API recherche-entreprises.api.gouv.fr ou votre pipeline de scraping.",
    },
    { status: 501 },
  );
}

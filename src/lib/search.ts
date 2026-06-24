import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getTenantDb } from "@/lib/tenant-context";
import { companyName, contactName } from "@/lib/display";

/**
 * Global search across companies + contacts, powered by MongoDB Atlas Search
 * (`$search`, the Lucene full-text engine). Prisma has no first-class `$search`,
 * so we drive it through `aggregateRaw`.
 *
 * Robustness: if `$search` throws — the Atlas Search index isn't built yet, or
 * we're pointed at a non-Atlas Mongo (local dev) — we fall back to a plain
 * regex `contains` query so the bar always returns *something*. Build the index
 * once with `npm run search:indexes` to switch on fuzzy/ranked results.
 */

export interface SearchHit {
  type: "company" | "contact";
  /** Always a company id — both result kinds link to the company detail page. */
  companyId: string;
  title: string;
  subtitle: string;
}

const SEARCH_INDEX = "default";
const COMPANY_PATHS = ["nomSociete", "enseigne", "ville", "siret", "siren", "emailGenerique"];
const CONTACT_PATHS = ["nom", "prenom", "email", "telephone"];

/** Pull a string id out of a raw Mongo `_id` ({ $oid }) or ObjectId-ish value. */
function oid(v: unknown): string {
  if (v && typeof v === "object" && "$oid" in (v as Record<string, unknown>)) {
    return String((v as { $oid: string }).$oid);
  }
  return String(v);
}

export async function searchAll(query: string, limit = 6): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const prisma = await getTenantDb();
  // Try Atlas Search first. Fall back to regex on EITHER an error (non-Atlas
  // Mongo) OR an empty result: on some Atlas tiers `$search` against a not-yet-
  // built / missing index returns [] instead of throwing, so "empty" can't be
  // trusted to mean "no matches" until the index is live. Regex then guarantees
  // the bar still works. At this scale the extra query is cheap.
  try {
    const hits = await atlasSearch(prisma, q, limit);
    if (hits.length > 0) return hits;
  } catch {
    /* fall through to regex */
  }
  return regexSearch(prisma, q, limit);
}

type RawCompany = {
  _id: unknown;
  nomSociete?: string | null;
  enseigne?: string | null;
  ville?: string | null;
  siret?: string | null;
};
type RawContact = {
  _id: unknown;
  nom?: string | null;
  prenom?: string | null;
  email?: string | null;
  companyId?: unknown;
  company?: Array<{ nomSociete?: string | null; enseigne?: string | null }>;
};

async function atlasSearch(
  prisma: PrismaClient,
  q: string,
  limit: number,
): Promise<SearchHit[]> {
  const [companies, contacts] = await Promise.all([
    prisma.company.aggregateRaw({
      pipeline: [
        {
          $search: {
            index: SEARCH_INDEX,
            text: { query: q, path: COMPANY_PATHS, fuzzy: { maxEdits: 1 } },
          },
        },
        { $limit: limit },
        { $project: { nomSociete: 1, enseigne: 1, ville: 1, siret: 1 } },
      ],
    }),
    prisma.contact.aggregateRaw({
      pipeline: [
        {
          $search: {
            index: SEARCH_INDEX,
            text: { query: q, path: CONTACT_PATHS, fuzzy: { maxEdits: 1 } },
          },
        },
        { $limit: limit },
        {
          $lookup: {
            from: "Company",
            localField: "companyId",
            foreignField: "_id",
            as: "company",
          },
        },
        {
          $project: {
            nom: 1,
            prenom: 1,
            email: 1,
            companyId: 1,
            "company.nomSociete": 1,
            "company.enseigne": 1,
          },
        },
      ],
    }),
  ]);

  return [
    ...(companies as unknown as RawCompany[]).map(companyHit),
    ...(contacts as unknown as RawContact[]).map(contactHit),
  ];
}

function companyHit(c: RawCompany): SearchHit {
  return {
    type: "company",
    companyId: oid(c._id),
    title: companyName(c),
    subtitle: [c.ville, c.siret].filter(Boolean).join(" · ") || "Société",
  };
}

function contactHit(c: RawContact): SearchHit {
  const company = c.company?.[0];
  return {
    type: "contact",
    companyId: oid(c.companyId),
    title: contactName(c),
    subtitle:
      [company ? companyName(company) : null, c.email].filter(Boolean).join(" · ") ||
      "Contact",
  };
}

/** Regex fallback — works on any Mongo, even before the Atlas index exists. */
async function regexSearch(
  prisma: PrismaClient,
  q: string,
  limit: number,
): Promise<SearchHit[]> {
  const ci = { contains: q, mode: "insensitive" as const };
  const [companies, contacts] = await Promise.all([
    prisma.company.findMany({
      where: {
        OR: [
          { nomSociete: ci },
          { enseigne: ci },
          { ville: ci },
          { siret: { contains: q } },
          { siren: { contains: q } },
        ],
      } satisfies Prisma.CompanyWhereInput,
      take: limit,
      select: { id: true, nomSociete: true, enseigne: true, ville: true, siret: true },
    }),
    prisma.contact.findMany({
      where: {
        OR: [{ nom: ci }, { prenom: ci }, { email: ci }],
      } satisfies Prisma.ContactWhereInput,
      take: limit,
      select: {
        nom: true,
        prenom: true,
        email: true,
        companyId: true,
        company: { select: { nomSociete: true, enseigne: true } },
      },
    }),
  ]);

  return [
    ...companies.map((c) => ({
      type: "company" as const,
      companyId: c.id,
      title: companyName(c),
      subtitle: [c.ville, c.siret].filter(Boolean).join(" · ") || "Société",
    })),
    ...contacts.map((c) => ({
      type: "contact" as const,
      companyId: c.companyId,
      title: contactName(c),
      subtitle:
        [c.company ? companyName(c.company) : null, c.email]
          .filter(Boolean)
          .join(" · ") || "Contact",
    })),
  ];
}

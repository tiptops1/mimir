import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getTenantDb } from "@/lib/tenant-context";

/**
 * Global search across the inventory, powered by MongoDB Atlas Search
 * (`$search`, the Lucene full-text engine). Prisma has no first-class
 * `$search`, so we drive it through `aggregateRaw`.
 *
 * The operator searches the way they think about stock — a SKU off a label, a
 * reference number off a caseback, a serial, a brand. Two collections carry
 * that: InventoryUnit (the physical item) and ProductRef (the catalogue entry
 * it points at). A ref hit resolves to its units, because there is nothing to
 * open for a bare reference — the answer to "Speedmaster" is the Speedmasters
 * in stock.
 *
 * Robustness: if `$search` throws — the Atlas Search index isn't built yet, or
 * we're pointed at a non-Atlas Mongo (local dev) — we fall back to a plain
 * regex `contains` query so the bar always returns *something*. Build the index
 * once with `npm run search:indexes` to switch on fuzzy/ranked results.
 */

export interface SearchHit {
  type: "unit" | "ref";
  /** InventoryUnit id — every hit opens a unit detail page. */
  unitId: string;
  title: string;
  subtitle: string;
}

const SEARCH_INDEX = "default";
const UNIT_PATHS = ["sku", "serial", "supplier", "notes"];
const REF_PATHS = ["brand", "reference", "model", "variant", "aliases"];

/** Pull a string id out of a raw Mongo `_id` ({ $oid }) or ObjectId-ish value. */
function oid(v: unknown): string {
  if (v && typeof v === "object" && "$oid" in (v as Record<string, unknown>)) {
    return String((v as { $oid: string }).$oid);
  }
  return String(v);
}

/** "Omega Speedmaster 311.30.42" — the ref as a person would say it. */
function refLabel(r: {
  brand?: string | null;
  model?: string | null;
  reference?: string | null;
  variant?: string | null;
}): string {
  return [r.brand, r.model, r.reference, r.variant].filter(Boolean).join(" ").trim();
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

type RawUnit = {
  _id: unknown;
  sku?: string | null;
  serial?: string | null;
  status?: string | null;
  ref?: Array<{
    brand?: string | null;
    model?: string | null;
    reference?: string | null;
    variant?: string | null;
  }>;
};

async function atlasSearch(
  prisma: PrismaClient,
  q: string,
  limit: number,
): Promise<SearchHit[]> {
  const [units, refs] = await Promise.all([
    prisma.inventoryUnit.aggregateRaw({
      pipeline: [
        {
          $search: {
            index: SEARCH_INDEX,
            text: { query: q, path: UNIT_PATHS, fuzzy: { maxEdits: 1 } },
          },
        },
        { $limit: limit },
        {
          $lookup: {
            from: "ProductRef",
            localField: "refId",
            foreignField: "_id",
            as: "ref",
          },
        },
        {
          $project: {
            sku: 1,
            serial: 1,
            status: 1,
            "ref.brand": 1,
            "ref.model": 1,
            "ref.reference": 1,
            "ref.variant": 1,
          },
        },
      ],
    }),
    // A ref match is only useful through its units, so the lookup runs the
    // other way and the pipeline unwinds back onto units before projecting.
    prisma.productRef.aggregateRaw({
      pipeline: [
        {
          $search: {
            index: SEARCH_INDEX,
            text: { query: q, path: REF_PATHS, fuzzy: { maxEdits: 1 } },
          },
        },
        { $limit: limit },
        {
          $lookup: {
            from: "InventoryUnit",
            localField: "_id",
            foreignField: "refId",
            as: "units",
          },
        },
        { $unwind: "$units" },
        { $limit: limit },
        {
          $project: {
            _id: "$units._id",
            sku: "$units.sku",
            serial: "$units.serial",
            status: "$units.status",
            ref: [
              {
                brand: "$brand",
                model: "$model",
                reference: "$reference",
                variant: "$variant",
              },
            ],
          },
        },
      ],
    }),
  ]);

  return dedupe([
    ...(units as unknown as RawUnit[]).map((u) => rawHit(u, "unit")),
    ...(refs as unknown as RawUnit[]).map((u) => rawHit(u, "ref")),
  ]);
}

function rawHit(u: RawUnit, type: SearchHit["type"]): SearchHit {
  const ref = u.ref?.[0];
  return {
    type,
    unitId: oid(u._id),
    title: (ref ? refLabel(ref) : "") || u.sku || "Unité",
    subtitle: [u.sku, u.serial].filter(Boolean).join(" · ") || "Unité",
  };
}

/**
 * A unit found by BOTH its own fields and its ref's would otherwise appear
 * twice. The unit-path hit is listed first and therefore wins.
 */
function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.unitId) && seen.add(h.unitId));
}

/** Regex fallback — works on any Mongo, even before the Atlas index exists. */
async function regexSearch(
  prisma: PrismaClient,
  q: string,
  limit: number,
): Promise<SearchHit[]> {
  const ci = { contains: q, mode: "insensitive" as const };
  const select = {
    id: true,
    sku: true,
    serial: true,
    ref: { select: { brand: true, model: true, reference: true, variant: true } },
  };

  const [units, refUnits] = await Promise.all([
    prisma.inventoryUnit.findMany({
      where: {
        OR: [{ sku: ci }, { serial: ci }, { supplier: ci }, { notes: ci }],
      } satisfies Prisma.InventoryUnitWhereInput,
      take: limit,
      select,
    }),
    prisma.inventoryUnit.findMany({
      where: {
        ref: {
          is: {
            OR: [
              { brand: ci },
              { model: ci },
              { reference: ci },
              { variant: ci },
              { aliases: { has: q.toLowerCase() } },
            ],
          },
        },
      } satisfies Prisma.InventoryUnitWhereInput,
      take: limit,
      select,
    }),
  ]);

  const toHit = (
    u: (typeof units)[number],
    type: SearchHit["type"],
  ): SearchHit => ({
    type,
    unitId: u.id,
    title: (u.ref ? refLabel(u.ref) : "") || u.sku || "Unité",
    subtitle: [u.sku, u.serial].filter(Boolean).join(" · ") || "Unité",
  });

  return dedupe([
    ...units.map((u) => toHit(u, "unit")),
    ...refUnits.map((u) => toHit(u, "ref")),
  ]);
}

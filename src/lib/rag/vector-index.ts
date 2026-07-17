import type { PrismaClient } from "@prisma/client";
import { EMBEDDING_DIMS } from "@/lib/ai/embed";

// Provision + verify the per-tenant Atlas `$vectorSearch` index over
// KnowledgeChunk.embedding (S11). Same createSearchIndexes shape as
// scripts/create-search-indexes.ts's text indexes, but a vectorSearch
// definition instead of Lucene dynamic mapping.

export const VECTOR_INDEX_NAME = "vector_default";

/**
 * Create the vector index if it doesn't exist yet. Idempotent — safe to call
 * on every tenant provision / backfill run. Does NOT touch the index budget;
 * callers must reserve a slot first (index-budget.ts) so a failed reservation
 * never leaves an orphan index.
 */
export async function ensureVectorIndex(prisma: PrismaClient): Promise<void> {
  try {
    await prisma.$runCommandRaw({
      createSearchIndexes: "KnowledgeChunk",
      indexes: [
        {
          name: VECTOR_INDEX_NAME,
          type: "vectorSearch",
          definition: {
            fields: [
              {
                type: "vector",
                path: "embedding",
                numDimensions: EMBEDDING_DIMS,
                similarity: "cosine",
              },
            ],
          },
        },
      ],
    });
    console.log(`✓ KnowledgeChunk: vector index "${VECTOR_INDEX_NAME}" created`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/already exists|Duplicate|IndexAlreadyExists/i.test(msg)) {
      console.log(`· KnowledgeChunk: vector index already exists — skipped`);
      return;
    }
    if (/Search Index Commands.*Atlas|not supported|Unrecognized|CommandNotFound/i.test(msg)) {
      console.error(
        `✗ KnowledgeChunk: this Mongo doesn't support Atlas Search (need an Atlas cluster). (${msg})`,
      );
      return;
    }
    throw e;
  }
}

type ListedIndex = { name: string; status?: string; queryable?: boolean };

/**
 * Verify the vector index is actually queryable before trusting `$vectorSearch`
 * results. Closes the "$search on a missing/building index returns [] instead
 * of throwing" trap — an empty retrieve() result can't be told apart from "no
 * matches" otherwise.
 */
export async function isVectorIndexReady(prisma: PrismaClient): Promise<boolean> {
  const rows = (await prisma.knowledgeChunk.aggregateRaw({
    pipeline: [{ $listSearchIndexes: { name: VECTOR_INDEX_NAME } }],
  })) as unknown as ListedIndex[];
  const idx = rows.find((r) => r.name === VECTOR_INDEX_NAME);
  return !!idx && idx.status === "READY" && idx.queryable === true;
}

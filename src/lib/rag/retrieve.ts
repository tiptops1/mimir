import type { PrismaClient } from "@prisma/client";
import { embedTexts } from "@/lib/ai/embed";
import { VECTOR_INDEX_NAME } from "./vector-index";

// Read-side of Mímisbrunnr (S12): embed a query, run Atlas `$vectorSearch`
// over KnowledgeChunk, return passages. Read-only — no AgentEvent, matching
// S13's "read-only, no side effects" demo posture. Prisma client is always
// the caller's first arg (ledger.ts/meter.ts/embed.ts convention), so this
// stays callable from session-less contexts (S14's Huginn job later).

export interface Passage {
  docId: string;
  chunkId: string;
  text: string;
  score: number;
}

type RawHit = {
  _id: unknown;
  docId: unknown;
  text: string;
  score: number;
};

/** Pull a string id out of a raw Mongo `_id` ({ $oid }) or ObjectId-ish value. */
function oid(v: unknown): string {
  if (v && typeof v === "object" && "$oid" in (v as Record<string, unknown>)) {
    return String((v as { $oid: string }).$oid);
  }
  return String(v);
}

export async function retrieve(
  prisma: PrismaClient,
  query: string,
  opts?: { limit?: number },
): Promise<Passage[]> {
  const q = query.trim();
  if (q.length === 0) return [];
  const limit = opts?.limit ?? 8;

  const [queryVector] = await embedTexts(prisma, [q], "RETRIEVAL_QUERY");

  const rows = (await prisma.knowledgeChunk.aggregateRaw({
    pipeline: [
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: "embedding",
          queryVector,
          numCandidates: Math.max(limit * 10, 100),
          limit,
        },
      },
      {
        $project: {
          docId: 1,
          text: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ],
  })) as unknown as RawHit[];

  return rows.map(toPassage);
}

export function toPassage(r: RawHit): Passage {
  return { docId: oid(r.docId), chunkId: oid(r._id), text: r.text, score: r.score };
}

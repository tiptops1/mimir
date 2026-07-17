// S10 — embedding spike: Gemini (gemini-embedding-001) vs Voyage (voyage-4) on
// ~50 synthetic French insurance-broker chunks. No DB touched, no tenant
// involved — pure API comparison to close the docs/mimir/roadmap.md S10
// decision. Run:
//
//   npx tsx scripts/rag/embedding-spike.ts
//
// (VOYAGE_API_KEY + GEMINI_API_KEY must be in .env)

import "dotenv/config";
import { CHUNKS, EVAL_QUERIES, type Chunk } from "./spike-data";

const GEMINI_MODEL = "gemini-embedding-001";
const GEMINI_DIMS = 768; // matches roadmap's M0-cluster-cost-conscious framing
const VOYAGE_MODEL = "voyage-4";

interface EmbeddingResult {
  vectors: number[][];
  dims: number;
  ms: number;
  approxTokens: number;
}

// Gemini has no documented per-request token count in the embed response, so
// approximate for cost estimation only (French ~= 1 token per ~4 chars).
function approxTokens(texts: string[]): number {
  return texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
}

async function embedGemini(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<EmbeddingResult> {
  const key = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchEmbedContents?key=${key}`;
  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${GEMINI_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: GEMINI_DIMS,
      })),
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    embeddings: Array<{ values: number[] }>;
  };
  return {
    vectors: data.embeddings.map((e) => e.values),
    dims: data.embeddings[0]?.values.length ?? 0,
    ms: Date.now() - t0,
    approxTokens: approxTokens(texts),
  };
}

async function embedVoyage(
  texts: string[],
  inputType: "document" | "query",
): Promise<EmbeddingResult> {
  const key = process.env.VOYAGE_API_KEY!;
  const t0 = Date.now();
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: inputType }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embed ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
    usage?: { total_tokens?: number };
  };
  return {
    vectors: data.data.map((d) => d.embedding),
    dims: data.data[0]?.embedding.length ?? 0,
    ms: Date.now() - t0,
    approxTokens: data.usage?.total_tokens ?? approxTokens(texts),
  };
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function evalRetrieval(
  chunks: Chunk[],
  chunkVectors: number[][],
  queryVectors: number[][],
): { recallAt1: number; recallAt3: number; misses: Array<{ query: string; expected: string; got: string }> } {
  let hit1 = 0, hit3 = 0;
  const misses: Array<{ query: string; expected: string; got: string }> = [];

  EVAL_QUERIES.forEach((eq, qi) => {
    const scored = chunks
      .map((c, ci) => ({ id: c.id, score: cosineSim(queryVectors[qi], chunkVectors[ci]) }))
      .sort((a, b) => b.score - a.score);
    const top1 = scored[0];
    const top3Ids = scored.slice(0, 3).map((s) => s.id);
    if (top1.id === eq.expectedId) hit1++;
    else misses.push({ query: eq.query, expected: eq.expectedId, got: top1.id });
    if (top3Ids.includes(eq.expectedId)) hit3++;
  });

  return {
    recallAt1: hit1 / EVAL_QUERIES.length,
    recallAt3: hit3 / EVAL_QUERIES.length,
    misses,
  };
}

async function runProvider(
  name: string,
  embedDocs: () => Promise<EmbeddingResult>,
  embedQueries: () => Promise<EmbeddingResult>,
  pricePerMillionTokens: number,
) {
  console.log(`\n=== ${name} ===`);
  const docs = await embedDocs();
  const queries = await embedQueries();
  const { recallAt1, recallAt3, misses } = evalRetrieval(CHUNKS, docs.vectors, queries.vectors);
  const totalTokens = docs.approxTokens + queries.approxTokens;
  const estCost = (totalTokens / 1_000_000) * pricePerMillionTokens;

  console.log(`dims: ${docs.dims}`);
  console.log(`latency: docs(${CHUNKS.length}) ${docs.ms}ms, queries(${EVAL_QUERIES.length}) ${queries.ms}ms`);
  console.log(`tokens (approx): ${totalTokens} -> est. $${estCost.toFixed(6)} @ $${pricePerMillionTokens}/1M`);
  console.log(`recall@1: ${(recallAt1 * 100).toFixed(1)}%  recall@3: ${(recallAt3 * 100).toFixed(1)}%`);
  if (misses.length) {
    console.log(`misses (${misses.length}):`);
    for (const m of misses) {
      console.log(`  "${m.query}" -> expected ${m.expected}, got ${m.got}`);
    }
  }
  return { name, dims: docs.dims, recallAt1, recallAt3, estCost, missCount: misses.length };
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing from .env");
  if (!process.env.VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY missing from .env");

  console.log(`Chunks: ${CHUNKS.length}, eval queries: ${EVAL_QUERIES.length}`);

  const texts = CHUNKS.map((c) => c.text);
  const queryTexts = EVAL_QUERIES.map((q) => q.query);

  const geminiResult = await runProvider(
    `Gemini (${GEMINI_MODEL}, dims=${GEMINI_DIMS})`,
    () => embedGemini(texts, "RETRIEVAL_DOCUMENT"),
    () => embedGemini(queryTexts, "RETRIEVAL_QUERY"),
    0.15,
  );

  const voyageResult = await runProvider(
    `Voyage (${VOYAGE_MODEL})`,
    () => embedVoyage(texts, "document"),
    () => embedVoyage(queryTexts, "query"),
    0, // voyage-4: first 200M tokens free per account (2026-07 pricing page)
  );

  console.log("\n=== summary ===");
  console.table([geminiResult, voyageResult]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

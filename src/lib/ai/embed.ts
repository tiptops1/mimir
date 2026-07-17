import type { PrismaClient } from "@prisma/client";
import * as meter from "./meter";

// Gemini embeddings (S10 decision, promoted from scripts/rag/embedding-spike.ts):
// gemini-embedding-001 truncated to 768 dims (Matryoshka) — headroom to shrink
// further if the S12 index cap bites. Usage is recorded in the AI meter for
// visibility (free tier prices at $0, same posture as gemini-2.5-flash).

export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMS = 768;

/** batchEmbedContents hard limit is 100 requests per call. */
const BATCH_LIMIT = 100;

export type EmbedTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

// French ~= 1 token per ~4 chars; the embed response reports no token counts.
function approxTokens(texts: string[]): number {
  return texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
}

async function embedBatch(texts: string[], taskType: EmbedTaskType): Promise<number[][]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMS,
      })),
    }),
  });
  if (!res.ok) {
    // Throw (rather than return null) so Inngest step retries handle 429/5xx.
    throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { embeddings: Array<{ values: number[] }> };
  if (data.embeddings.length !== texts.length) {
    throw new Error(
      `Gemini embed returned ${data.embeddings.length} vectors for ${texts.length} texts`,
    );
  }
  return data.embeddings.map((e) => e.values);
}

/**
 * Embed texts in document order (batched at the API limit). Throws on any
 * failure — callers run inside retryable queue steps.
 */
export async function embedTexts(
  prisma: PrismaClient,
  texts: string[],
  taskType: EmbedTaskType,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_LIMIT) {
    vectors.push(...(await embedBatch(texts.slice(i, i + BATCH_LIMIT), taskType)));
  }
  await meter.recordUsage(prisma, {
    provider: "gemini",
    model: EMBEDDING_MODEL,
    taskClass: "embed",
    promptTokens: approxTokens(texts),
    completionTokens: 0,
  });
  return vectors;
}

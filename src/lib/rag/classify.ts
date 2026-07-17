import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { callByTaskClass } from "@/lib/ai/router";
import { getActivePrompt, renderPrompt, type ActivePrompt } from "@/lib/prompts";

// Mimisbrunnr health classifier (S11, D3 exclusion posture). Every chunk is
// classified by Haiku BEFORE storage/embedding; flagged chunks are quarantined
// as hash + verdict only — the text itself is dropped. Fail closed: content
// whose verdict is missing or unparseable is treated as flagged, never stored.

export const HEALTH_CLASSIFIER_PROMPT_KEY = "mimisbrunnr.health_classifier";

/** How many chunks are sent to the model per call. */
export const CLASSIFY_BATCH_SIZE = 10;

export const verdictSchema = z.object({
  i: z.number().int().min(0),
  flag: z.boolean(),
  categories: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(1),
  reason: z.string().default(""),
});
export type Verdict = z.infer<typeof verdictSchema>;

export const verdictArraySchema = z.array(verdictSchema);

export interface PartitionedChunks {
  clean: Array<{ seq: number; text: string }>;
  flagged: Array<{ seq: number; contentHash: string; verdict: Verdict }>;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Route chunks by their verdicts. Pure — the whole D3 quarantine decision is
 * testable without an LLM. `verdicts` may be null (call failed / unparseable):
 * fail closed, every chunk in the batch is flagged with a synthetic verdict.
 * A chunk whose verdict is simply missing from the array is flagged too.
 * Flagged output carries the hash + verdict only, never the text.
 */
export function partitionByVerdict(
  chunks: Array<{ seq: number; text: string }>,
  verdicts: Verdict[] | null,
): PartitionedChunks {
  const bySeqIndex = new Map<number, Verdict>();
  if (verdicts) {
    for (const v of verdicts) bySeqIndex.set(v.i, v);
  }

  const clean: PartitionedChunks["clean"] = [];
  const flagged: PartitionedChunks["flagged"] = [];

  chunks.forEach((chunk, idx) => {
    const verdict = bySeqIndex.get(idx);
    if (verdict && !verdict.flag) {
      clean.push(chunk);
      return;
    }
    flagged.push({
      seq: chunk.seq,
      contentHash: sha256(chunk.text),
      verdict:
        verdict ??
        ({
          i: idx,
          flag: true,
          categories: ["unverified"],
          confidence: 1,
          reason: verdicts
            ? "No verdict returned for this chunk — fail closed"
            : "Classifier unavailable or unparseable output — fail closed",
        } satisfies Verdict),
    });
  });

  return { clean, flagged };
}

/** Extract + validate the verdict array from raw model output. Null = fail closed. */
export function parseVerdicts(text: string | null): Verdict[] | null {
  if (!text) return null;
  // Models sometimes wrap JSON in a code fence — strip it before parsing.
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    const parsed = verdictArraySchema.safeParse(JSON.parse(stripped));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Classify one batch of chunks with the tenant's active classifier prompt
 * (Haiku via the metered router). Returns null when the call fails or the
 * budget is exhausted — callers must treat null as "quarantine everything"
 * (partitionByVerdict does exactly that).
 */
export async function classifyBatch(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  chunks: Array<{ seq: number; text: string }>,
): Promise<Verdict[] | null> {
  const user = JSON.stringify(
    chunks.map((c, idx) => ({ i: idx, text: c.text })),
  );
  const system = renderPrompt(prompt, { chunks: String(chunks.length) });
  const reply = await callByTaskClass(prisma, "classify", system, user, {
    maxTokens: 2000,
  });
  return parseVerdicts(reply);
}

export async function getClassifierPrompt(prisma: PrismaClient): Promise<ActivePrompt> {
  return getActivePrompt(prisma, HEALTH_CLASSIFIER_PROMPT_KEY);
}

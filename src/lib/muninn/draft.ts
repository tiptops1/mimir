import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { callByTaskClass } from "@/lib/ai/router";
import { renderPrompt, type ActivePrompt } from "@/lib/prompts";
import type { Passage } from "@/lib/rag/retrieve";

// Muninn RCA-doc pipeline (S16) — domain logic for per-section drafting
// (Sonnet). Generic by design: everything vertical-specific (French RCA
// vocabulary, section instructions) lives in the seeded PromptTemplate bodies
// (muninn.rca_doc.section.*), never here. LLM output is parsed fail-closed:
// unparseable or budget-exhausted output is null, never a guess — mirrors
// src/lib/huginn/draft.ts.

export const MUNINN_MODULE = "muninn";
export const MUNINN_CATEGORY = "muninn.rca_doc";
export const MUNINN_ACTION_TYPE = "doc.rca_draft";
export const MUNINN_DEFAULT_TEMPLATE_KEY = "muninn.rca_doc.default";

/** PROPOSED drafts expire after this long (same posture as Huginn's DRAFT_EXPIRY_DAYS). */
export const RCA_DRAFT_EXPIRY_DAYS = 7;

/** Cap on the activity text sent to the LLMs (input hygiene, not a token limit). */
const MAX_BODY_CHARS = 4000;
/** Cap on the retrieval query text (embed input hygiene). */
const MAX_QUERY_CHARS = 1500;

export const rcaSectionOutputSchema = z.object({
  content: z.string().min(1),
});
export type RcaSectionOutput = z.infer<typeof rcaSectionOutputSchema>;

export interface RcaTemplateSection {
  key: string;
  label: string;
  promptKey: string;
}

export interface IncidentActivityInput {
  summary: string; // aiSummary, or a fallback built from subject/note
  body: string;
  sentiment: string | null;
}

export interface RcaSectionResult {
  key: string;
  label: string;
  content: string | null; // null = draft failed for this section; still proposed
  promptKey: string;
  promptVersion: number; // pins the exact PromptTemplate version that drafted this section
}

/** Strip an optional ```json fence (huginn/draft.ts:stripFence pattern). */
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
}

/** Parse + validate a section draft from raw model output. Null = fail closed. */
export function parseRcaSectionOutput(text: string | null): RcaSectionOutput | null {
  if (!text) return null;
  try {
    const parsed = rcaSectionOutputSchema.safeParse(JSON.parse(stripFence(text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The text embedded for retrieval, scoped per section: incident text + section label. */
export function buildSectionRetrievalQuery(
  activity: IncidentActivityInput,
  sectionLabel: string,
): string {
  return `${sectionLabel}\n\n${activity.summary}\n\n${activity.body}`
    .trim()
    .slice(0, MAX_QUERY_CHARS);
}

function activityJson(activity: IncidentActivityInput): {
  summary: string;
  body: string;
  sentiment: string | null;
} {
  return {
    summary: activity.summary,
    body: activity.body.slice(0, MAX_BODY_CHARS),
    sentiment: activity.sentiment,
  };
}

/**
 * Draft one RCA section (Sonnet via the metered router). Passages are the
 * only facts the prompt allows for procedures/garanties; an empty list is
 * legitimate. Null = call failed / budget exhausted / unparseable.
 */
export async function draftRcaSection(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  activity: IncidentActivityInput,
  passages: Passage[],
): Promise<RcaSectionOutput | null> {
  const system = renderPrompt(prompt, {});
  const user = JSON.stringify({
    activity: activityJson(activity),
    passages: passages.map((p) => ({ id: p.chunkId, text: p.text })),
  });
  const reply = await callByTaskClass(prisma, "draft", system, user, {
    maxTokens: 600,
  });
  return parseRcaSectionOutput(reply);
}

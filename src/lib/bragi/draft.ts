import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { callByTaskClass } from "@/lib/ai/router";
import { renderPrompt, type ActivePrompt } from "@/lib/prompts";
import type { Passage } from "@/lib/rag/retrieve";

// Bragi content pipeline (S18) — domain logic for drafting one content piece
// (Sonnet) from a calendar slot's topic/brief, grounded on RAG passages and
// styled by the tenant's BrandVoice pack. Generic by design: everything
// vertical-specific (French marketing vocabulary, channel style, brand voice)
// lives in seeded config (PromptTemplate bodies + BrandVoice rows), never
// here. LLM output is parsed fail-closed — mirrors src/lib/muninn/draft.ts.

export const BRAGI_MODULE = "bragi";
export const BRAGI_CATEGORY = "bragi.content";
export const BRAGI_ACTION_TYPE = "content.draft";
export const DEFAULT_BRAND_VOICE_KEY = "bragi.brand_voice.default";

/** PROPOSED drafts expire after this long (same posture as Huginn/Muninn). */
export const CONTENT_DRAFT_EXPIRY_DAYS = 7;

/** Cap on the retrieval query text (embed input hygiene). */
const MAX_QUERY_CHARS = 1500;
/** Cap on the brief text sent to the drafting model (input hygiene). */
const MAX_BRIEF_CHARS = 4000;

export const contentOutputSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});
export type ContentOutput = z.infer<typeof contentOutputSchema>;

export interface ContentSlotInput {
  channel: string;
  topic: string;
  brief: string | null;
}

export interface BrandVoiceInput {
  persona: string;
  tone: string;
  audience: string;
  language: string;
  doList: string[];
  dontList: string[];
  vocabulary: string[];
}

/** Strip an optional ```json fence (huginn/draft.ts:stripFence pattern). */
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
}

/** Parse + validate a content draft from raw model output. Null = fail closed. */
export function parseContentOutput(text: string | null): ContentOutput | null {
  if (!text) return null;
  try {
    const parsed = contentOutputSchema.safeParse(JSON.parse(stripFence(text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The PromptTemplate key that drafts one channel — unknown channels fail loudly in getActivePrompt. */
export function promptKeyForChannel(channel: string): string {
  return `bragi.content.draft.${channel}`;
}

/**
 * Render a BrandVoice row into the compact French block injected as the
 * {{brandVoice}} prompt variable. Pure; empty lists are omitted.
 */
export function renderBrandVoiceBlock(voice: BrandVoiceInput): string {
  const lines = [
    `Persona : ${voice.persona}`,
    `Ton : ${voice.tone}`,
    `Audience : ${voice.audience}`,
    `Langue : ${voice.language}`,
  ];
  if (voice.doList.length > 0) {
    lines.push("À faire :", ...voice.doList.map((d) => `- ${d}`));
  }
  if (voice.dontList.length > 0) {
    lines.push("À éviter :", ...voice.dontList.map((d) => `- ${d}`));
  }
  if (voice.vocabulary.length > 0) {
    lines.push(`Vocabulaire privilégié : ${voice.vocabulary.join(", ")}`);
  }
  return lines.join("\n");
}

/** The text embedded for retrieval: topic + brief, capped. */
export function buildContentRetrievalQuery(slot: ContentSlotInput): string {
  return `${slot.topic}\n\n${slot.brief ?? ""}`.trim().slice(0, MAX_QUERY_CHARS);
}

/**
 * Draft one content piece (Sonnet via the metered router). Passages are the
 * only facts the prompt allows for garanties/chiffres/procédures; an empty
 * list is legitimate — content stays general. Null = call failed / budget
 * exhausted / unparseable.
 */
export async function draftContentPiece(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  voiceBlock: string,
  slot: ContentSlotInput,
  passages: Passage[],
): Promise<ContentOutput | null> {
  const system = renderPrompt(prompt, { brandVoice: voiceBlock });
  const user = JSON.stringify({
    topic: slot.topic,
    brief: (slot.brief ?? "").slice(0, MAX_BRIEF_CHARS),
    passages: passages.map((p) => ({ id: p.chunkId, text: p.text })),
  });
  const reply = await callByTaskClass(prisma, "draft", system, user, {
    // Generous headroom: blog_article/newsletter bodies run to 400-600 words
    // and JSON-escaping doubles every literal newline — 900 truncated the
    // output mid-string on a real run (parseContentOutput correctly failed
    // closed on the malformed JSON, but the cap itself was too tight).
    maxTokens: 2000,
  });
  return parseContentOutput(reply);
}

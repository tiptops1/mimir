import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { callByTaskClass } from "@/lib/ai/router";
import { renderPrompt, type ActivePrompt } from "@/lib/prompts";
import type { Passage } from "@/lib/rag/retrieve";

// Huginn draft pipeline (S14b) — domain logic for classify (Haiku) -> draft
// (Sonnet). Generic by design: everything vertical-specific (French support
// vocabulary, tone, category list) lives in the seeded PromptTemplate bodies
// (huginn.support_reply.*), never here. LLM output is parsed fail-closed:
// unparseable or budget-exhausted output is null, never a guess.

export const HUGINN_MODULE = "huginn";
export const HUGINN_CATEGORY = "huginn.support_reply";
export const HUGINN_ACTION_TYPE = "email.draft_reply";
export const HUGINN_CLASSIFY_PROMPT_KEY = "huginn.support_reply.classify";
export const HUGINN_DRAFT_PROMPT_KEY = "huginn.support_reply.draft";

/** PROPOSED drafts expire after this long (sweepExpired isn't cron-wired yet
 * — the date is still recorded so S15's surface can grey stale drafts out). */
export const DRAFT_EXPIRY_DAYS = 7;

/** Activity.huginnStatus terminal values. Unset = not yet processed. */
export const HUGINN_STATUS = {
  drafted: "DRAFTED",
  skippedNotSupport: "SKIPPED_NOT_SUPPORT",
  quarantinedHealth: "QUARANTINED_HEALTH",
  failed: "FAILED",
} as const;

/** Cap on the email body sent to the LLMs (input hygiene, not a token limit). */
const MAX_BODY_CHARS = 4000;
/** Cap on the retrieval query text (embed input hygiene). */
const MAX_QUERY_CHARS = 1500;

export const supportVerdictSchema = z.object({
  support: z.boolean(),
  category: z.string().default("autre"),
  confidence: z.number().min(0).max(1).default(1),
  reason: z.string().default(""),
});
export type SupportVerdict = z.infer<typeof supportVerdictSchema>;

export const draftOutputSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});
export type DraftOutput = z.infer<typeof draftOutputSchema>;

export interface InboundEmailInput {
  fromEmail: string;
  subject: string;
  body: string;
}

/** Strip an optional ```json fence (classify.ts:parseVerdicts pattern). */
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
}

/** Parse + validate a support verdict from raw model output. Null = fail closed. */
export function parseSupportVerdict(text: string | null): SupportVerdict | null {
  if (!text) return null;
  try {
    const parsed = supportVerdictSchema.safeParse(JSON.parse(stripFence(text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Parse + validate a draft from raw model output. Null = fail closed. */
export function parseDraftOutput(text: string | null): DraftOutput | null {
  if (!text) return null;
  try {
    const parsed = draftOutputSchema.safeParse(JSON.parse(stripFence(text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The text embedded for retrieval: subject + body, capped. */
export function buildRetrievalQuery(email: InboundEmailInput): string {
  return `${email.subject}\n\n${email.body}`.trim().slice(0, MAX_QUERY_CHARS);
}

function emailJson(email: InboundEmailInput): {
  from: string;
  subject: string;
  body: string;
} {
  return {
    from: email.fromEmail,
    subject: email.subject,
    body: email.body.slice(0, MAX_BODY_CHARS),
  };
}

/**
 * Is this a support email the tenant should answer? Haiku via the metered
 * router. Null when the call fails, the budget is exhausted, or the output
 * doesn't validate — callers must fail closed (skip nothing silently).
 */
export async function classifySupportEmail(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  email: InboundEmailInput,
): Promise<SupportVerdict | null> {
  const system = renderPrompt(prompt, {});
  const user = JSON.stringify(emailJson(email));
  const reply = await callByTaskClass(prisma, "classify", system, user, {
    maxTokens: 300,
  });
  return parseSupportVerdict(reply);
}

/**
 * Draft a grounded reply (Sonnet via the metered router). Passages are the
 * only facts the prompt allows; an empty list is legitimate (the prompt's
 * "stay general" case). Null = call failed / budget exhausted / unparseable.
 */
export async function draftSupportReply(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  email: InboundEmailInput,
  category: string,
  passages: Passage[],
): Promise<DraftOutput | null> {
  const system = renderPrompt(prompt, {});
  const user = JSON.stringify({
    email: emailJson(email),
    category,
    passages: passages.map((p) => ({ id: p.chunkId, text: p.text })),
  });
  const reply = await callByTaskClass(prisma, "draft", system, user, {
    maxTokens: 1200,
  });
  return parseDraftOutput(reply);
}

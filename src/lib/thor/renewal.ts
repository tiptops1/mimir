import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { callByTaskClass } from "@/lib/ai/router";
import { renderPrompt, type ActivePrompt } from "@/lib/prompts";
import type { Passage } from "@/lib/rag/retrieve";
import type { CompanyHealthResult } from "./health";

// Thor renewal pipeline (S22b) — domain logic for drafting one retention-
// outreach email (Sonnet) from an at-risk/critical company's health signals
// (S22a, src/lib/thor/health.ts). Generic by design: the retention-email
// vocabulary/tone lives in the seeded thor.renewal.draft PromptTemplate,
// never here. LLM output is parsed fail-closed — mirrors src/lib/bragi/draft.ts.

export const THOR_MODULE = "thor";
export const THOR_RENEWAL_CATEGORY = "thor.renewal";
export const THOR_RENEWAL_ACTION_TYPE = "renewal.outreach_draft";
export const THOR_RENEWAL_PROMPT_KEY = "thor.renewal.draft";

/** PROPOSED drafts expire after this long (same posture as Huginn/Muninn/Bragi). */
export const RENEWAL_DRAFT_EXPIRY_DAYS = 7;

/** Cap on the retrieval query text (embed input hygiene). */
const MAX_QUERY_CHARS = 1500;

export const renewalOutputSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});
export type RenewalOutput = z.infer<typeof renewalOutputSchema>;

export interface RenewalCompanyInput {
  companyId: string;
  companyName: string;
}

/** Strip an optional ```json fence (huginn/draft.ts:stripFence pattern). */
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
}

/** Parse + validate a renewal draft from raw model output. Null = fail closed. */
export function parseRenewalOutput(text: string | null): RenewalOutput | null {
  if (!text) return null;
  try {
    const parsed = renewalOutputSchema.safeParse(JSON.parse(stripFence(text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The text embedded for retrieval: company name + band + signal labels, capped. */
export function buildRenewalRetrievalQuery(
  company: RenewalCompanyInput,
  health: Pick<CompanyHealthResult, "band" | "signals">,
): string {
  const signalLine = health.signals.map((s) => s.label).join(", ");
  return `${company.companyName}\n\n${health.band}\n\n${signalLine}`.trim().slice(0, MAX_QUERY_CHARS);
}

/**
 * Draft one retention-outreach email (Sonnet via the metered router).
 * Passages are the only facts the prompt allows for garanties/chiffres/
 * procédures; an empty list is legitimate — the email stays general. Null =
 * call failed / budget exhausted / unparseable.
 */
export async function draftRenewalOutreach(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  company: RenewalCompanyInput,
  health: Pick<CompanyHealthResult, "score" | "band" | "signals">,
  passages: Passage[],
): Promise<RenewalOutput | null> {
  const system = renderPrompt(prompt, {});
  const user = JSON.stringify({
    companyName: company.companyName,
    score: health.score,
    band: health.band,
    signals: health.signals.map((s) => ({ key: s.key, label: s.label, detail: s.detail })),
    passages: passages.map((p) => ({ id: p.chunkId, text: p.text })),
  });
  const reply = await callByTaskClass(prisma, "draft", system, user, {
    maxTokens: 900,
  });
  return parseRenewalOutput(reply);
}

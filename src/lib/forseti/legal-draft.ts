import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { callByTaskClass } from "@/lib/ai/router";
import { getActivePrompt, renderPrompt } from "@/lib/prompts";
import {
  classifyBatch,
  getClassifierPrompt,
  partitionByVerdict,
  sha256,
} from "@/lib/rag/classify";

// Forseti legal drafting (S23) — contract review / terms drafting. Same
// fail-closed draft shape as src/lib/bragi/draft.ts and src/lib/muninn/draft.ts,
// with one addition: the input is a broker-pasted contract/terms text, not
// tenant-authored config, so it goes through the same HDS gate as Bragi's
// briefs (src/lib/jobs/bragi-generate.ts) before any drafting call — no free
// text reaches a drafting model ungated.

export const FORSETI_LEGAL_MODULE = "forseti";

export type LegalDocType = "contract_review" | "terms_draft";

/** Cap on the pasted contract/terms text sent to the drafting model. */
const MAX_INPUT_CHARS = 8000;

export const legalOutputSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});
export type LegalOutput = z.infer<typeof legalOutputSchema>;

/** Strip an optional ```json fence (bragi/draft.ts:stripFence pattern). */
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
}

/** Parse + validate a legal draft from raw model output. Null = fail closed. */
export function parseLegalOutput(text: string | null): LegalOutput | null {
  if (!text) return null;
  try {
    const parsed = legalOutputSchema.safeParse(JSON.parse(stripFence(text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The PromptTemplate key for one docType — unknown docTypes fail loudly in getActivePrompt. */
export function promptKeyForDocType(docType: LegalDocType): string {
  return `forseti.legal.draft.${docType}`;
}

/** The text embedded in the draft call: the pasted contract/terms text, capped. */
export function buildLegalRetrievalQuery(inputText: string): string {
  return inputText.trim().slice(0, MAX_INPUT_CHARS);
}

export type LegalDraftResult =
  | { outcome: "quarantined" }
  | { outcome: "drafted"; draft: LegalOutput; promptKey: string; promptVersion: number }
  | { outcome: "failed" };

export interface LegalDraftInput {
  docType: LegalDocType;
  companyId: string;
  companyName: string;
  inputText: string;
}

/**
 * Draft one legal document (Sonnet via the metered router), gated by the HDS
 * health classifier first. Mirrors the Bragi brief-gate posture exactly:
 * flagged input is quarantined (hash + verdict logged, text dropped, nothing
 * drafted); a classifier that's unreachable also fails closed.
 */
export async function draftLegalDocument(
  prisma: PrismaClient,
  input: LegalDraftInput,
): Promise<LegalDraftResult> {
  const text = buildLegalRetrievalQuery(input.inputText);

  const classifierPrompt = await getClassifierPrompt(prisma);
  const chunk = [{ seq: 0, text }];
  const verdicts = await classifyBatch(prisma, classifierPrompt, chunk);
  if (verdicts === null) {
    throw new Error("Health classifier unavailable — fail closed, nothing drafted");
  }
  const { flagged } = partitionByVerdict(chunk, verdicts);
  if (flagged.length > 0) {
    const f = flagged[0];
    await prisma.agentEvent.create({
      data: {
        module: FORSETI_LEGAL_MODULE,
        category: "legal.document_draft",
        action: "quarantined",
        entity: "COMPANY",
        entityId: input.companyId,
        data: {
          contentHash: sha256(text),
          categories: f.verdict.categories,
          confidence: f.verdict.confidence,
          promptKey: classifierPrompt.key,
          promptVersion: classifierPrompt.version,
        },
      },
    });
    return { outcome: "quarantined" };
  }

  const promptKey = promptKeyForDocType(input.docType);
  const prompt = await getActivePrompt(prisma, promptKey);
  const system = renderPrompt(prompt, { companyName: input.companyName });
  // Contract-review findings can run long; 1500 truncated real output
  // mid-JSON on a first pass (same failure Bragi hit before bumping
  // 900 -> 2000, src/lib/bragi/draft.ts:118-121). parseLegalOutput correctly
  // failed closed on the malformed JSON, but the cap itself was too tight.
  const reply = await callByTaskClass(prisma, "draft", system, text, { maxTokens: 3000 });
  const draft = parseLegalOutput(reply);
  if (!draft) return { outcome: "failed" };
  return { outcome: "drafted", draft, promptKey: prompt.key, promptVersion: prompt.version };
}

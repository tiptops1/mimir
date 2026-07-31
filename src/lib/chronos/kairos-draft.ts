import type { PrismaClient } from "@prisma/client";
import { callByTaskClass } from "@/lib/ai/router";
import { renderPrompt, type ActivePrompt } from "@/lib/prompts";
import { classifyBatch, partitionByVerdict, sha256 } from "@/lib/rag/classify";
import { getActivePrompt } from "@/lib/prompts";
import { KAIROS_GATE_PROMPT_KEY } from "./kairos";
import { parseKairosOutput, type KairosOutput, type ScoredListing } from "./kairos";
import { formatCents } from "@/lib/display";

// Kairos drafting — the model-facing half. Pure arithmetic lives in kairos.ts;
// this file is what actually talks to a model, which is why the gate below is
// here and not optional.

/** Raised from Bragi's 900: a rationale citing several comps runs long. */
const DRAFT_MAX_TOKENS = 1200;

export interface ListingInput {
  externalId: string;
  title: string;
  description?: string;
  askPriceCents: number;
  currency: string;
  url?: string | null;
}

export interface GateResult {
  ok: boolean;
  /** Hash + reason only — the flagged text itself is NEVER persisted (S11). */
  contentHash?: string;
  reason?: string;
}

/**
 * THE MANDATORY GATE (S32 precondition).
 *
 * Every other module runs the S11 classifier because its input might contain
 * health data. Kairos runs it for a different reason, and the roadmap says so
 * explicitly: **a marketplace listing is untrusted third-party text**. A seller
 * controls every character of that title and description, and it is about to be
 * placed in front of a model that is deciding how much money to offer. That is
 * a prompt-injection surface, not a privacy one.
 *
 * Fails CLOSED: an unparseable or failed classifier call flags the whole batch,
 * exactly as partitionByVerdict already does for ingestion. A listing that
 * cannot be cleared is quarantined with a hash and a reason — never drafted
 * from, never stored verbatim.
 *
 * Note what this gate does NOT claim to do: it is a filter, not a proof. The
 * deterministic veto flags in kairos.ts and the hard bid ceiling exist because
 * no text filter should be the only thing standing between a stranger's prose
 * and a spending decision.
 */
export async function gateListingText(
  prisma: PrismaClient,
  listing: ListingInput,
): Promise<GateResult> {
  const text = `${listing.title}\n${listing.description ?? ""}`.trim();
  if (!text) return { ok: true };

  // Its OWN prompt, not Mímisbrunnr's `getClassifierPrompt`. That one is written
  // for health-data exclusion, is worded for the inherited broker vertical, and
  // its recall/precision were measured against that corpus at G2 — reusing it
  // here would both import stale vocabulary and silently repurpose a measured
  // classifier for a job it was never evaluated on. Same verdict machinery and
  // the same fail-closed partitioning; different question.
  const prompt = await getActivePrompt(prisma, KAIROS_GATE_PROMPT_KEY);
  const verdicts = await classifyBatch(prisma, prompt, [{ seq: 0, text }]);
  const { flagged } = partitionByVerdict([{ seq: 0, text }], verdicts);

  if (flagged.length > 0) {
    return {
      ok: false,
      contentHash: flagged[0].contentHash,
      reason: flagged[0].verdict.reason || "flagged by classifier",
    };
  }
  return { ok: true, contentHash: sha256(text) };
}

/**
 * Draft the offer rationale.
 *
 * The listing text is interpolated as a prompt VARIABLE, never concatenated
 * into the system instruction — the same separation every other module keeps,
 * and the reason it matters more here is in gateListingText's header.
 *
 * Returns null on an unusable model response so the caller proposes nothing:
 * failing closed on a money action is the only acceptable default.
 */
export async function draftSourcingOffer(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  args: {
    refLabel: string;
    listing: ListingInput;
    scored: ScoredListing;
  },
): Promise<KairosOutput | null> {
  const { scored, listing } = args;
  if (!scored.ceiling) return null;

  const system = renderPrompt(prompt, {
    reference: args.refLabel,
    maxBid: formatCents(scored.ceiling.maxBidCents),
    expectedResale: formatCents(scored.ceiling.expectedResaleCents),
    targetMarginCents: String(scored.ceiling.requiredMarginCents),
  });

  const user = JSON.stringify({
    reference: args.refLabel,
    // Explicitly labelled as untrusted so the prompt can tell the model to
    // treat it as data. Belt and braces alongside the gate and the clamp.
    untrusted_listing_text: {
      title: listing.title,
      description: listing.description ?? "",
    },
    ask_price_cents: listing.askPriceCents,
    currency: listing.currency,
    computed_max_bid_cents: scored.ceiling.maxBidCents,
    expected_resale_cents: scored.ceiling.expectedResaleCents,
    estimated_fees_cents: scored.ceiling.estimatedFeesCents,
    refurb_cost_cents: scored.ceiling.refurbCostCents,
    required_margin_cents: scored.ceiling.requiredMarginCents,
    detected_flags: scored.flags,
  });

  const text = await callByTaskClass(prisma, "draft", system, user, {
    maxTokens: DRAFT_MAX_TOKENS,
  });

  return parseKairosOutput(text);
}

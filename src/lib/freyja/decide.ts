import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { callByTaskClass } from "@/lib/ai/router";
import { renderPrompt, type ActivePrompt } from "@/lib/prompts";
import type { CampaignAggregate } from "./metrics";

// Freyja decision pipeline (S25) — pure agent core. Deterministic pre-screen
// (flagCandidates) picks which campaigns deserve a look; Sonnet writes one
// structured decision per flagged campaign, parsed fail-closed (bragi/thor
// pattern). Marketing vocabulary/tone lives in the seeded
// freyja.campaign.decide PromptTemplate, never here.

export const FREYJA_MODULE = "freyja";
export const FREYJA_ACTION_TYPE = "campaign.decision";
export const FREYJA_DECIDE_PROMPT_KEY = "freyja.campaign.decide";

/** Decision kind -> autonomy category. Category carries the autonomy/ledger semantics; the action type is one UI branch. */
export const FREYJA_CATEGORIES = {
  budget_change: "freyja.budget_change",
  campaign_pause: "freyja.campaign_pause",
  bid_adjust: "freyja.bid_adjust",
} as const;
export type FreyjaDecisionKind = keyof typeof FREYJA_CATEGORIES;

/** PROPOSED decisions expire after this long (same posture as Huginn/Thor). */
export const DECISION_EXPIRY_DAYS = 7;
export const SCAN_BATCH_LIMIT = 10;

export const decisionOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("budget_change"),
    newDailyBudget: z.number().positive(),
    rationale: z.string().min(1),
  }),
  z.object({ kind: z.literal("campaign_pause"), rationale: z.string().min(1) }),
  z.object({
    kind: z.literal("bid_adjust"),
    bidAdjustPct: z.number().min(-50).max(50),
    rationale: z.string().min(1),
  }),
  z.object({ kind: z.literal("none"), rationale: z.string().min(1) }),
]);
export type DecisionOutput = z.infer<typeof decisionOutputSchema>;

/** Strip an optional ```json fence (huginn/draft.ts:stripFence pattern). */
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
}

/** Parse + validate a decision from raw model output. Null = fail closed. */
export function parseDecisionOutput(text: string | null): DecisionOutput | null {
  if (!text) return null;
  try {
    const parsed = decisionOutputSchema.safeParse(JSON.parse(stripFence(text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ── Pre-screen ───────────────────────────────────────────────────────────────

export interface FreyjaScreenConfig {
  roasFloor: number;
  minSpend14dEur: number;
}

export interface CampaignFlag {
  key: "spend_no_conversions" | "roas_below_floor" | "ctr_decay" | "scaling_opportunity";
  label: string; // French — payload evidence shown in the inbox
  detail: string;
}

/**
 * Deterministic candidate rules over a 14-day aggregate. A campaign with no
 * flags is never sent to the model — the LLM decides *what to do*, not *whether
 * to look*. All rules require the minimum 14d spend (too little data = noise).
 */
export function flagCampaign(
  aggregate: CampaignAggregate,
  config: FreyjaScreenConfig,
  campaign: { dailyBudget: number },
): CampaignFlag[] {
  const flags: CampaignFlag[] = [];
  const { totals, rates, last7, prior7 } = aggregate;
  if (totals.spendEur < config.minSpend14dEur) return flags;

  if (totals.conversions === 0) {
    flags.push({
      key: "spend_no_conversions",
      label: "Dépense sans conversion",
      detail: `${totals.spendEur.toFixed(0)} € dépensés sur 14 jours sans aucune conversion`,
    });
  } else if (rates.roas !== null && rates.roas < config.roasFloor) {
    flags.push({
      key: "roas_below_floor",
      label: "ROAS sous le plancher",
      detail: `ROAS 14 j de ${rates.roas.toFixed(2)} (plancher ${config.roasFloor})`,
    });
  }

  if (
    last7.rates.ctr !== null &&
    prior7.rates.ctr !== null &&
    prior7.rates.ctr > 0 &&
    last7.rates.ctr < prior7.rates.ctr * 0.6
  ) {
    flags.push({
      key: "ctr_decay",
      label: "Fatigue créative",
      detail: `CTR en baisse : ${(last7.rates.ctr * 100).toFixed(2)} % sur 7 j contre ${(prior7.rates.ctr * 100).toFixed(2)} % la semaine précédente`,
    });
  }

  if (
    rates.roas !== null &&
    rates.roas >= config.roasFloor * 2 &&
    totals.spendEur >= campaign.dailyBudget * 14 * 0.85
  ) {
    flags.push({
      key: "scaling_opportunity",
      label: "Opportunité de scaling",
      detail: `ROAS 14 j de ${rates.roas.toFixed(2)} avec un budget consommé à saturation`,
    });
  }

  return flags;
}

// ── Guardrail primitive ──────────────────────────────────────────────────────

export interface BudgetDeltaCheck {
  ok: boolean;
  deltaPct: number;
}

/**
 * The max-budget-delta guardrail (first magnitude cap in the platform).
 * Enforced pre-propose (skip + event) AND at execute (failAction) — always
 * against the CURRENT budget at that moment.
 */
export function checkBudgetDelta(
  currentDailyBudget: number,
  newDailyBudget: number,
  maxBudgetDeltaPct: number,
): BudgetDeltaCheck {
  if (currentDailyBudget <= 0) {
    return { ok: false, deltaPct: Number.POSITIVE_INFINITY };
  }
  const deltaPct =
    (Math.abs(newDailyBudget - currentDailyBudget) / currentDailyBudget) * 100;
  return { ok: deltaPct <= maxBudgetDeltaPct, deltaPct };
}

// ── LLM decision ─────────────────────────────────────────────────────────────

export interface DecisionCampaignInput {
  campaignId: string;
  name: string;
  channel: string;
  status: string;
  dailyBudget: number;
  bidAdjustPct: number;
}

/**
 * One decision for one flagged campaign (Sonnet via the metered router).
 * `kind: "none"` is a legitimate output — the prompt tells the model to
 * decline when the evidence is thin. Null = call failed / unparseable.
 */
export async function draftCampaignDecision(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  campaign: DecisionCampaignInput,
  aggregate: CampaignAggregate,
  flags: CampaignFlag[],
  dailySeries: Array<{ day: string; spendEur: number; clicks: number; conversions: number; conversionValue: number }>,
  maxBudgetDeltaPct: number,
): Promise<DecisionOutput | null> {
  const system = renderPrompt(prompt, {
    maxBudgetDeltaPct: String(maxBudgetDeltaPct),
  });
  const user = JSON.stringify({
    campaign,
    flags: flags.map((f) => ({ key: f.key, label: f.label, detail: f.detail })),
    aggregates: {
      days: aggregate.days,
      totals: aggregate.totals,
      rates: aggregate.rates,
      last7: aggregate.last7,
      prior7: aggregate.prior7,
    },
    dailySeries,
  });
  const reply = await callByTaskClass(prisma, "draft", system, user, {
    maxTokens: 600,
  });
  return parseDecisionOutput(reply);
}

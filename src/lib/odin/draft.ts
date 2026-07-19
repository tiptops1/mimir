import type { AutonomyConfig, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { callByTaskClass } from "@/lib/ai/router";
import { renderPrompt, type ActivePrompt } from "@/lib/prompts";
import {
  getPilotStats,
  getTokenUsageSnapshot,
  listActiveDirectives,
  listRecentAgentEvents,
} from "@/lib/nornir/queries";
import { listAutonomyConfigs } from "@/lib/heimdallr/queries";

// Odin's review pipeline (S20/S21, docs/mimir/odin.md §5) — domain logic for
// the daily synthesis: build a compact JSON snapshot of platform state, ask
// Sonnet whether a directive is worth proposing, parse fail-closed. No
// multi-step pipeline (no Inngest) — a single model call over aggregates
// that already exist, same posture as src/lib/bragi/draft.ts.

export const ODIN_MODULE = "odin";
export const ODIN_CATEGORY = "odin.directive";
export const ODIN_ACTION_TYPE = "directive.set";
/** Module-local, non-actionable telemetry (mirrors mimisbrunnr's "ingestion"). */
export const ODIN_REVIEW_CATEGORY = "review";
export const ODIN_REVIEW_PROMPT_KEY = "odin.review.propose_directive";

/** Proposed directives expire after this long (same posture as every other module). */
export const DIRECTIVE_EXPIRY_DAYS = 7;

const directiveScopeSchema = z.enum(["tenant", "module", "category"]);
const directiveModeSchema = z.enum(["standing", "dispatch"]);

const directiveDraftBodySchema = z.object({
  key: z.string().min(1),
  scope: directiveScopeSchema,
  module: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  objective: z.string().min(1),
  constraints: z.record(z.string(), z.unknown()).nullable().optional(),
  mode: directiveModeSchema,
});

// Loose top-level shape first (propose:false has none of the other fields),
// the draft body's own required fields are re-validated separately below —
// discriminatedUnion can't take an intersection schema as a member.
const reviewOutputSchema = z.object({
  propose: z.boolean(),
  key: z.string().optional(),
  scope: z.string().optional(),
  module: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  objective: z.string().optional(),
  constraints: z.record(z.string(), z.unknown()).nullable().optional(),
  mode: z.string().optional(),
});

export type DirectiveDraft = z.infer<typeof directiveDraftBodySchema>;

/** Strip an optional ```json fence (huginn/draft.ts:stripFence pattern). */
function stripFence(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
}

/**
 * Parse the review model's raw output. Null = nothing to propose today, which
 * covers both an explicit `{"propose": false}` and any unparseable/invalid
 * output — fail-closed, never a guessed directive.
 */
export function parseReviewOutput(text: string | null): DirectiveDraft | null {
  if (!text) return null;
  try {
    const shell = reviewOutputSchema.safeParse(JSON.parse(stripFence(text)));
    if (!shell.success || !shell.data.propose) return null;
    const draft = directiveDraftBodySchema.safeParse(shell.data);
    return draft.success ? draft.data : null;
  } catch {
    return null;
  }
}

export interface ReviewInput {
  pilot: {
    companyCount: number;
    contactCount: number;
    openPipeline: number;
    netThisMonth: number;
    pendingApprovals: number;
  };
  aiUsage: {
    spentUsd: number;
    limitUsd: number;
    overBudget: boolean;
    byTaskClass: { taskClass: string; costUsd: number; calls: number }[];
  };
  autonomyConfigs: {
    category: string;
    level: number;
    maxLevel: number;
    paused: boolean;
    lastBreakerReason: string | null;
  }[];
  recentEvents: { module: string; category: string; action: string; at: string }[];
  activeDirectives: { key: string; scope: string; module: string | null; objective: string; mode: string }[];
}

/** Compact the module's own AutonomyConfig read into the review's shape. */
export function summarizeAutonomyConfigs(configs: AutonomyConfig[]): ReviewInput["autonomyConfigs"] {
  return configs.map((c) => ({
    category: c.category,
    level: c.level,
    maxLevel: c.maxLevel,
    paused: c.paused,
    lastBreakerReason: c.lastBreakerReason,
  }));
}

/** Gather every input the review needs — all already-implemented reads, no new query. */
export async function buildReviewInput(prisma: PrismaClient): Promise<ReviewInput> {
  const [pilot, usage, configs, events, directives] = await Promise.all([
    getPilotStats(prisma),
    getTokenUsageSnapshot(prisma),
    listAutonomyConfigs(prisma),
    listRecentAgentEvents(prisma, { limit: 30 }),
    listActiveDirectives(prisma),
  ]);

  return {
    pilot: {
      companyCount: pilot.companyCount,
      contactCount: pilot.contactCount,
      openPipeline: pilot.openPipeline,
      netThisMonth: pilot.netThisMonth,
      pendingApprovals: pilot.pendingApprovals,
    },
    aiUsage: {
      spentUsd: usage.spentUsd,
      limitUsd: usage.limitUsd,
      overBudget: usage.overBudget,
      byTaskClass: usage.byTaskClass,
    },
    autonomyConfigs: summarizeAutonomyConfigs(configs),
    recentEvents: events.map((e) => ({
      module: e.module,
      category: e.category,
      action: e.action,
      at: e.at.toISOString(),
    })),
    activeDirectives: directives.map((d) => ({
      key: d.key,
      scope: d.scope,
      module: d.module,
      objective: d.objective,
      mode: d.mode,
    })),
  };
}

/**
 * Run the review model over a snapshot (Sonnet via the metered router). Null
 * = call failed / budget exhausted / model decided nothing needs to change —
 * fail-closed on every path.
 */
export async function reviewSnapshot(
  prisma: PrismaClient,
  prompt: ActivePrompt,
  input: ReviewInput,
): Promise<DirectiveDraft | null> {
  const system = renderPrompt(prompt, {});
  const user = JSON.stringify(input);
  const reply = await callByTaskClass(prisma, "draft", system, user, { maxTokens: 700 });
  return parseReviewOutput(reply);
}

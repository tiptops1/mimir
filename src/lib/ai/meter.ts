import type { PrismaClient } from "@prisma/client";

// Per-tenant AI cost ledger (AiUsage) + monthly budget gate (AiBudget). Same
// spirit as lib/leadone/quota.ts (per-provider counter, hard stop) but keyed
// by cost instead of call count, and updated via atomic `increment` — an AI
// call can originate from any concurrent request/cron run, unlike Lead One's
// single-writer pipeline, so a read-then-update counter would race.

export type Provider = "gemini" | "anthropic";

// $/MTok, from docs/mimir/AGENTIC-PLATFORM-DECISION-MEMO.md (snapshot 2026-07,
// verify at https://docs.claude.com before relying on this for real billing).
// Gemini 2.5 Flash is priced at 0: the enrichment path only runs on the free
// tier (see ai-extract.ts), so it is genuinely $0 cost to us — tokens/calls
// are still recorded for visibility.
const PRICING: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash": { in: 0, out: 0 },
  "claude-haiku-4-5-20251001": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-opus-4-8": { in: 5, out: 25 },
};

// Fallback budget when a tenant has no AiBudget row yet (shouldn't happen post
// seed, but never treat a missing row as "unlimited").
const DEFAULT_MONTHLY_LIMIT_USD = 20;

function costUsd(model: string, promptTokens: number, completionTokens: number): number {
  const rate = PRICING[model];
  if (!rate) return 0; // unknown model: don't block a call over a pricing-table gap
  return (promptTokens / 1_000_000) * rate.in + (completionTokens / 1_000_000) * rate.out;
}

function dayKey(at: Date): string {
  return at.toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

function monthPrefix(at: Date): string {
  return at.toISOString().slice(0, 7); // YYYY-MM
}

export interface UsageInput {
  provider: Provider;
  model: string;
  taskClass: string;
  promptTokens: number;
  completionTokens: number;
}

/** Record one call's token usage against today's ledger row (atomic increment). */
export async function recordUsage(prisma: PrismaClient, u: UsageInput): Promise<void> {
  const day = dayKey(new Date());
  const cost = costUsd(u.model, u.promptTokens, u.completionTokens);
  await prisma.aiUsage.upsert({
    where: {
      day_provider_model_taskClass: {
        day,
        provider: u.provider,
        model: u.model,
        taskClass: u.taskClass,
      },
    },
    create: {
      day,
      provider: u.provider,
      model: u.model,
      taskClass: u.taskClass,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      costUsd: cost,
      calls: 1,
    },
    update: {
      promptTokens: { increment: u.promptTokens },
      completionTokens: { increment: u.completionTokens },
      costUsd: { increment: cost },
      calls: { increment: 1 },
    },
  });
}

/** Sum costUsd across this (UTC) calendar month's AiUsage rows. */
export async function monthSpend(prisma: PrismaClient, at: Date = new Date()): Promise<number> {
  const prefix = monthPrefix(at);
  const rows = await prisma.aiUsage.findMany({
    where: { day: { startsWith: prefix } },
    select: { costUsd: true },
  });
  return rows.reduce((sum, r) => sum + r.costUsd, 0);
}

export interface BudgetStatus {
  ok: boolean;
  used: number;
  limit: number;
}

/**
 * Pre-call budget check. Cost isn't known until the response arrives, so this
 * gates on spend-so-far vs. limit rather than "reserving" the next call's
 * cost — same trade-off as LeadOneQuota.takeQuota's "reserve n" but for a
 * number that can't be known upfront: at most one call's worth of overshoot.
 */
export async function checkBudget(prisma: PrismaClient): Promise<BudgetStatus> {
  const budget = await prisma.aiBudget.findUnique({ where: { singleton: "default" } });
  const limit = budget?.monthlyLimitUsd ?? DEFAULT_MONTHLY_LIMIT_USD;
  const used = await monthSpend(prisma);
  return { ok: used < limit, used, limit };
}

/** Read-only usage rows, newest first — for the reporting script. */
export async function usageSnapshot(prisma: PrismaClient) {
  return prisma.aiUsage.findMany({ orderBy: [{ day: "desc" }, { provider: "asc" }] });
}

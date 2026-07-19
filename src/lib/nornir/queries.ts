import type { AgentEvent, OdinDirective, PrismaClient } from "@prisma/client";
import { countPendingActions } from "@/lib/heimdallr/queries";
import { computeFinanceCockpit } from "@/lib/finance-cockpit";
import { checkBudget, usageSnapshot } from "@/lib/ai/meter";

// Read-side for the Nornir pilot dashboard. Same convention as
// heimdallr/queries.ts: tenant PrismaClient as first arg, no getTenantDb()
// import here.

export interface PilotStats {
  companyCount: number;
  contactCount: number;
  stageCounts: { stage: string; count: number }[];
  openPipeline: number;
  netThisMonth: number;
  pendingApprovals: number;
}

/** "The whole company at a glance" — reuses the same cockpit math as Finances/Dashboard. */
export async function getPilotStats(prisma: PrismaClient): Promise<PilotStats> {
  const [companyCount, contactCount, companies, cockpit, pendingApprovals] =
    await Promise.all([
      prisma.company.count(),
      prisma.contact.count(),
      prisma.company.findMany({ select: { stage: true } }),
      computeFinanceCockpit(prisma),
      countPendingActions(prisma),
    ]);

  const byStage = new Map<string, number>();
  for (const c of companies) byStage.set(c.stage, (byStage.get(c.stage) ?? 0) + 1);

  return {
    companyCount,
    contactCount,
    stageCounts: [...byStage.entries()].map(([stage, count]) => ({ stage, count })),
    openPipeline: cockpit.openPipeline,
    netThisMonth: cockpit.net,
    pendingApprovals,
  };
}

/** Every currently-ACTIVE Odin directive (S21), for the "Objectifs actifs" card and the review snapshot. */
export async function listActiveDirectives(prisma: PrismaClient): Promise<OdinDirective[]> {
  return prisma.odinDirective.findMany({
    where: { status: "ACTIVE" },
    orderBy: { key: "asc" },
  });
}

/** Recent agent activity, newest first — uses the `at` / `[module,category,at]` indexes. */
export async function listRecentAgentEvents(
  prisma: PrismaClient,
  opts: { limit?: number; module?: string } = {},
): Promise<AgentEvent[]> {
  return prisma.agentEvent.findMany({
    where: opts.module ? { module: opts.module } : undefined,
    orderBy: { at: "desc" },
    take: opts.limit ?? 20,
  });
}

export interface TokenUsageSummary {
  spentUsd: number;
  limitUsd: number;
  overBudget: boolean;
  byTaskClass: { taskClass: string; costUsd: number; calls: number }[];
  byDay: { day: string; costUsd: number; calls: number }[];
}

/** Month-to-date AI spend vs. budget, rolled up for display (wraps ai/meter.ts, doesn't recompute it). */
export async function getTokenUsageSnapshot(prisma: PrismaClient): Promise<TokenUsageSummary> {
  const [budget, rows] = await Promise.all([checkBudget(prisma), usageSnapshot(prisma)]);

  const monthPrefix = new Date().toISOString().slice(0, 7);
  const thisMonth = rows.filter((r) => r.day.startsWith(monthPrefix));

  const byTaskClassMap = new Map<string, { costUsd: number; calls: number }>();
  const byDayMap = new Map<string, { costUsd: number; calls: number }>();
  for (const r of thisMonth) {
    const tc = byTaskClassMap.get(r.taskClass) ?? { costUsd: 0, calls: 0 };
    tc.costUsd += r.costUsd;
    tc.calls += r.calls;
    byTaskClassMap.set(r.taskClass, tc);

    const d = byDayMap.get(r.day) ?? { costUsd: 0, calls: 0 };
    d.costUsd += r.costUsd;
    d.calls += r.calls;
    byDayMap.set(r.day, d);
  }

  return {
    spentUsd: budget.used,
    limitUsd: budget.limit,
    overBudget: !budget.ok,
    byTaskClass: [...byTaskClassMap.entries()]
      .map(([taskClass, v]) => ({ taskClass, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byDay: [...byDayMap.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => b.day.localeCompare(a.day)),
  };
}

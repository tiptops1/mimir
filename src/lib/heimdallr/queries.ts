import type { AgentAction, AutonomyConfig, Prisma, PrismaClient } from "@prisma/client";

// Read-side companion to ledger.ts (the write API). Same convention: tenant
// PrismaClient as first arg, no getTenantDb() import here, so these stay
// callable from session-less contexts too.

export type PendingActionFilters = {
  category?: string;
  module?: string;
  q?: string;
};

function buildPendingWhere(filters: PendingActionFilters): Prisma.AgentActionWhereInput {
  const and: Prisma.AgentActionWhereInput[] = [{ status: "PROPOSED" }];
  if (filters.category) and.push({ category: filters.category });
  if (filters.module) and.push({ module: filters.module });
  if (filters.q) {
    const ci = { contains: filters.q, mode: "insensitive" as const };
    and.push({ OR: [{ type: ci }, { entity: ci }, { entityId: ci }] });
  }
  return { AND: and };
}

/** Pending proposals for the inbox, oldest first — uses the [status, proposedAt] index. */
export async function listPendingActions(
  prisma: PrismaClient,
  filters: PendingActionFilters = {},
): Promise<AgentAction[]> {
  return prisma.agentAction.findMany({
    where: buildPendingWhere(filters),
    orderBy: { proposedAt: "asc" },
  });
}

/** Unfiltered PROPOSED count, for the "X à valider" subtitle. */
export async function countPendingActions(prisma: PrismaClient): Promise<number> {
  return prisma.agentAction.count({ where: { status: "PROPOSED" } });
}

/**
 * Executed, reversible actions — candidates for the undo tray (level-2
 * auto_with_undo categories, events.md §3). Whether each is still inside its
 * undo window is derived at render time via state-machine.ts's isUndoable,
 * not recomputed here.
 */
export async function listUndoTrayActions(prisma: PrismaClient): Promise<AgentAction[]> {
  return prisma.agentAction.findMany({
    where: { status: "EXECUTED", reversible: true },
    orderBy: { executedAt: "desc" },
  });
}

/** All AutonomyConfig rows, for resolving category -> French label + undoWindowMinutes. */
export async function listAutonomyConfigs(prisma: PrismaClient): Promise<AutonomyConfig[]> {
  return prisma.autonomyConfig.findMany({ orderBy: { category: "asc" } });
}

/**
 * Trailing-window unedited/sample counts for one category's graduation eligibility
 * (events.md "Graduation-math inputs" eligible set): status ∈ {APPROVED, EXECUTED, UNDONE}
 * and autonomyLevelAtProposal == 1 — only human-reviewed drafts count toward earning level 2.
 * Same window-math shape as evaluateBreaker's count pair in ledger.ts.
 */
export async function getUneditedStats(
  prisma: PrismaClient,
  category: string,
  graduationWindowDays: number,
  now: Date = new Date(),
): Promise<{ sample: number; count: number }> {
  const since = new Date(now.getTime() - graduationWindowDays * 86_400_000);
  const eligible: Prisma.AgentActionWhereInput = {
    category,
    status: { in: ["APPROVED", "EXECUTED", "UNDONE"] },
    autonomyLevelAtProposal: 1,
    decidedAt: { gte: since },
  };
  const [sample, count] = await Promise.all([
    prisma.agentAction.count({ where: eligible }),
    prisma.agentAction.count({ where: { ...eligible, wasEdited: false } }),
  ]);
  return { sample, count };
}

/** AutonomyConfig rows currently eligible to graduate (level 1, maxLevel >= 2) — used by
 * both the graduation sweep and the inbox's progress display. */
export async function listGraduationCandidates(prisma: PrismaClient): Promise<AutonomyConfig[]> {
  return prisma.autonomyConfig.findMany({
    where: { level: 1, maxLevel: { gte: 2 } },
    orderBy: { category: "asc" },
  });
}

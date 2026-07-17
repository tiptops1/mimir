import type { PrismaClient as ControlPrismaClient } from "@/generated/control";

// Cluster-wide Atlas Search index budget (SearchIndexBudget, control plane —
// see prisma/control/schema.prisma). Atlas caps search indexes per cluster,
// not per tenant DB, so this must be visible across every tenant sharing the
// cluster; AiBudget/LeadOneQuota's per-tenant shape doesn't fit here.

export class IndexBudgetExceededError extends Error {
  constructor(used: number, limit: number) {
    super(
      `Search index budget exhausted (${used}/${limit}) — upgrade the Atlas cluster tier ` +
        `(M0 -> Flex/M10) before provisioning another index.`,
    );
    this.name = "IndexBudgetExceededError";
  }
}

/** Pure: can this reservation proceed? Kept separate from the I/O for testing. */
export function canReserve(used: number, limit: number): boolean {
  return used < limit;
}

/**
 * Atomically reserve one index slot against the cluster-wide budget. Throws
 * IndexBudgetExceededError at the cap — callers must not create the index
 * anyway on failure. Not a check-then-act race: the increment only happens
 * after we've confirmed room, and MongoDB's per-document `$inc` combined with
 * the read-check keeps this safe for this repo's single-writer provisioning
 * flow (no concurrent tenant provisions expected).
 */
export async function checkAndReserveIndexSlot(control: ControlPrismaClient): Promise<void> {
  const budget = await control.searchIndexBudget.upsert({
    where: { singleton: "default" },
    update: {},
    create: { singleton: "default" },
  });
  if (!canReserve(budget.used, budget.limit)) {
    throw new IndexBudgetExceededError(budget.used, budget.limit);
  }
  await control.searchIndexBudget.update({
    where: { singleton: "default" },
    data: { used: { increment: 1 } },
  });
}

export async function indexBudgetSnapshot(control: ControlPrismaClient) {
  const budget = await control.searchIndexBudget.upsert({
    where: { singleton: "default" },
    update: {},
    create: { singleton: "default" },
  });
  return { used: budget.used, limit: budget.limit };
}

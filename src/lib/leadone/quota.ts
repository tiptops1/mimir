import type { PrismaClient } from "@prisma/client";

// Lead One free-tier budget ledger (LeadOneQuota collection). Every call to a
// quota-limited provider goes through takeQuota(); when a window has elapsed
// the counter resets — that is the whole "auto-resume when the free tier
// refreshes" mechanic. Single-writer by design (GH Actions concurrency group
// "leadone" + the UI never spends quota), so read-then-update is safe.

export type Provider = "google_cse" | "exa" | "hunter" | "serpapi";

export const QUOTA_DEFAULTS: Record<
  Provider,
  { limit: number; window: "DAILY" | "MONTHLY" }
> = {
  google_cse: { limit: 100, window: "DAILY" }, // resets midnight Pacific
  exa: { limit: 1000, window: "MONTHLY" }, // exa.ai free tier, calendar month
  hunter: { limit: 25, window: "MONTHLY" },
  serpapi: { limit: 250, window: "MONTHLY" }, // serpapi.com free tier — LinkedIn profile verification only
};

// Key identifying the window a timestamp belongs to. Google CSE resets at
// midnight America/Los_Angeles (covers PST/PDT); monthly quotas reset per
// calendar month (UTC is close enough for billing-cycle quotas).
function windowKey(window: string, at: Date): string {
  if (window === "DAILY") {
    // en-CA locale formats as YYYY-MM-DD
    return at.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  }
  return `${at.getUTCFullYear()}-${at.getUTCMonth() + 1}`;
}

export async function seedQuotas(prisma: PrismaClient): Promise<void> {
  for (const [provider, def] of Object.entries(QUOTA_DEFAULTS)) {
    await prisma.leadOneQuota.upsert({
      where: { provider },
      update: {}, // never clobber a live counter (limits are editable data)
      create: { provider, used: 0, ...def, windowStart: new Date() },
    });
  }
}

/**
 * Reserve `n` calls on a provider's free tier. Returns false when the budget
 * for the current window is exhausted (callers stop and let the next scheduled
 * run pick up after the reset).
 */
export async function takeQuota(
  prisma: PrismaClient,
  provider: Provider,
  n = 1,
): Promise<boolean> {
  const now = new Date();
  let q = await prisma.leadOneQuota.findUnique({ where: { provider } });
  if (!q) {
    const def = QUOTA_DEFAULTS[provider];
    q = await prisma.leadOneQuota.create({
      data: { provider, used: 0, ...def, windowStart: now },
    });
  }
  if (windowKey(q.window, q.windowStart) !== windowKey(q.window, now)) {
    q = await prisma.leadOneQuota.update({
      where: { provider },
      data: { used: 0, windowStart: now },
    });
  }
  if (q.used + n > q.limit) return false;
  await prisma.leadOneQuota.update({
    where: { provider },
    data: { used: q.used + n },
  });
  return true;
}

export interface QuotaSnapshot {
  provider: string;
  used: number;
  limit: number;
  window: string;
  windowStart: Date;
}

export async function quotaSnapshot(
  prisma: PrismaClient,
): Promise<QuotaSnapshot[]> {
  const rows = await prisma.leadOneQuota.findMany({
    orderBy: { provider: "asc" },
  });
  const now = new Date();
  // Present already-reset numbers when a window has elapsed but no run has
  // touched the row yet (read-only view — the reset itself happens in takeQuota).
  return rows.map((q) => ({
    provider: q.provider,
    used:
      windowKey(q.window, q.windowStart) === windowKey(q.window, now)
        ? q.used
        : 0,
    limit: q.limit,
    window: q.window,
    windowStart: q.windowStart,
  }));
}

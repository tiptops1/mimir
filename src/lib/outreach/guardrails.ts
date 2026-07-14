import type { PrismaClient, OutreachConfig } from "@prisma/client";
import { startOfParisDay } from "./business-days";

// The safety rails around the send engine. Deliverability is the whole game:
// a burned domain can't be un-burned, so every send run re-checks caps, the
// warm-up ramp and the bounce-rate circuit breaker before a single mail leaves.

const WEEK = 7 * 86_400_000;
// Below this many sends the trailing bounce RATE is noise (1 bounce out of 3
// sends is 33% but means nothing) — the breaker waits for a minimum sample.
const BREAKER_MIN_SAMPLE = 10;

/** The tenant's OutreachConfig singleton, created with defaults on first read. */
export async function getOutreachConfig(
  prisma: PrismaClient,
): Promise<OutreachConfig> {
  const existing = await prisma.outreachConfig.findFirst();
  if (existing) return existing;
  return prisma.outreachConfig.create({ data: {} });
}

/**
 * Today's effective send cap: the configured ceiling, limited by the warm-up
 * ramp when one is running (start low, +N per elapsed week since rampStartDate).
 */
export function effectiveDailyCap(config: OutreachConfig, now: Date): number {
  if (!config.rampStartDate || config.rampStartDate > now) return config.dailyCap;
  const weeks = Math.floor((now.getTime() - config.rampStartDate.getTime()) / WEEK);
  return Math.min(
    config.dailyCap,
    config.rampStartCap + weeks * config.rampWeeklyIncrement,
  );
}

/** Sends already recorded during today's Paris civil day (crash-safe cap). */
export async function sentToday(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  return prisma.outreachMessage.count({
    where: { sentAt: { gte: startOfParisDay(now) } },
  });
}

/**
 * Trailing-7-day bounce rate against the configured threshold. Returns a pause
 * reason, or null when sending may proceed.
 */
export async function bounceBreakerReason(
  prisma: PrismaClient,
  config: OutreachConfig,
  now: Date,
): Promise<string | null> {
  const since = new Date(now.getTime() - WEEK);
  const [sent, bounced] = await Promise.all([
    prisma.outreachMessage.count({ where: { sentAt: { gte: since } } }),
    prisma.outreachMessage.count({
      where: { sentAt: { gte: since }, status: "BOUNCED" },
    }),
  ]);
  if (sent < BREAKER_MIN_SAMPLE) return null;
  const pct = (bounced / sent) * 100;
  if (pct >= config.bounceThresholdPct) {
    return `Taux de bounce ${pct.toFixed(1)} % sur 7 jours (seuil ${config.bounceThresholdPct} %) — ${bounced}/${sent} emails.`;
  }
  return null;
}

/** Trip the circuit breaker: stop ALL sending until a human resumes it. */
export async function pauseOutreach(
  prisma: PrismaClient,
  config: OutreachConfig,
  reason: string,
): Promise<void> {
  await prisma.outreachConfig.update({
    where: { id: config.id },
    data: { paused: true, pausedReason: reason, pausedAt: new Date() },
  });
}

/** Does a Gmail send error mean "stop everything", not "skip this one"? */
export function isSpamOrQuotaError(e: unknown): boolean {
  const err = e as {
    code?: number;
    status?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
  const code = err?.code ?? err?.status;
  if (code === 429) return true;
  const reasons = (err?.errors ?? []).map((x) => x.reason ?? "");
  if (
    reasons.some((r) =>
      ["dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"].includes(r),
    )
  ) {
    return true;
  }
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("spam") || msg.includes("sending limit");
}

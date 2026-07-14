import type { PrismaClient } from "@prisma/client";
import { getStageDefs } from "@/lib/stage-config";

// Aggregation for the /outreach dashboard: Chris's 5 metrics + the funnel
// counts + the recent-sends feed. Server-side, one pass — same shape as
// finance-cockpit.ts. Windows are trailing 7-day (envoyés, réponse, bounce)
// and lifetime (RDV, closing) so the numbers reflect the machine's rhythm.

const WEEK = 7 * 86_400_000;

export interface OutreachStats {
  configured: boolean;
  // 5 headline numbers Chris tracks (§7 of the war-machine brief).
  sentLast7d: number;
  replyRatePct: number | null;
  meetingsBooked: number;
  won: number;
  bounceRatePct: number | null;
  bounceThresholdPct: number;
  // Enrollment funnel — total lifetime, active, replied, bounced/opted-out.
  funnel: {
    total: number;
    active: number;
    replied: number;
    bounced: number;
    optedOut: number;
    done: number;
  };
  paused: boolean;
  pausedReason: string | null;
  pausedAt: Date | null;
  dailyCap: number;
  sentToday: number;
}

export interface RecentSendRow {
  id: string;
  sentAt: Date;
  toEmail: string;
  subject: string;
  status: string;
  stepIndex: number;
  companyId: string;
  companyLabel: string;
  sequenceName: string;
}

export async function computeOutreachStats(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<OutreachStats> {
  const config = await prisma.outreachConfig.findFirst();
  const since = new Date(now.getTime() - WEEK);

  const [sent7, bounced7, allEnrollments, allSent, wonStages] = await Promise.all([
    prisma.outreachMessage.count({ where: { sentAt: { gte: since } } }),
    prisma.outreachMessage.count({
      where: { sentAt: { gte: since }, status: "BOUNCED" },
    }),
    prisma.enrollment.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { sequence: { mode: "AUTO_EMAIL" } },
    }),
    // Enrollments with at least one send (denominator for reply rate).
    prisma.outreachMessage.groupBy({
      by: ["enrollmentId"],
      _count: { _all: true },
    }),
    getStageDefs(),
  ]);

  const funnel = {
    total: 0,
    active: 0,
    replied: 0,
    bounced: 0,
    optedOut: 0,
    done: 0,
  };
  for (const g of allEnrollments) {
    funnel.total += g._count._all;
    if (g.status === "ACTIVE" || g.status === "PAUSED") funnel.active += g._count._all;
    else if (g.status === "REPLIED") funnel.replied += g._count._all;
    else if (g.status === "BOUNCED") funnel.bounced += g._count._all;
    else if (g.status === "OPTED_OUT") funnel.optedOut += g._count._all;
    else if (g.status === "DONE") funnel.done += g._count._all;
  }
  const enrolledWithSend = allSent.length;
  const replyRatePct =
    enrolledWithSend > 0 ? (funnel.replied / enrolledWithSend) * 100 : null;

  // "RDV obtenus" — MEETING activity logged after the first outreach send.
  // Cheap approximation: count companies that have BOTH a MEETING activity and
  // any outreach message. (For the correlate-by-date variant, we'd need a per-
  // company min(sentAt) then filter MEETINGs after it — deferred.)
  const enrolledCompanyIdsRaw = await prisma.outreachMessage.groupBy({
    by: ["companyId"],
    _count: { _all: true },
  });
  const enrolledCompanyIds = enrolledCompanyIdsRaw.map((r) => r.companyId);
  const [meetingsBooked, wonCount] =
    enrolledCompanyIds.length === 0
      ? [0, 0]
      : await Promise.all([
          prisma.activity
            .findMany({
              where: {
                companyId: { in: enrolledCompanyIds },
                type: "MEETING",
              },
              distinct: ["companyId"],
              select: { companyId: true },
            })
            .then((rows) => rows.length),
          prisma.company.count({
            where: {
              id: { in: enrolledCompanyIds },
              stage: { in: wonStages.filter((s) => s.isWon).map((s) => s.value) },
            },
          }),
        ]);

  const sentToday = await sentCountToday(prisma, now);

  return {
    configured: Boolean(config),
    sentLast7d: sent7,
    replyRatePct,
    meetingsBooked,
    won: wonCount,
    bounceRatePct: sent7 > 0 ? (bounced7 / sent7) * 100 : null,
    bounceThresholdPct: config?.bounceThresholdPct ?? 5,
    funnel,
    paused: config?.paused ?? false,
    pausedReason: config?.pausedReason ?? null,
    pausedAt: config?.pausedAt ?? null,
    dailyCap: config?.dailyCap ?? 25,
    sentToday,
  };
}

async function sentCountToday(prisma: PrismaClient, now: Date): Promise<number> {
  const { startOfParisDay } = await import("./business-days");
  return prisma.outreachMessage.count({
    where: { sentAt: { gte: startOfParisDay(now) } },
  });
}

export async function recentOutreachMessages(
  prisma: PrismaClient,
  limit = 12,
): Promise<RecentSendRow[]> {
  const rows = await prisma.outreachMessage.findMany({
    orderBy: { sentAt: "desc" },
    take: limit,
    include: {
      company: {
        select: { id: true, nomSociete: true, enseigne: true, siret: true },
      },
      sequence: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    sentAt: r.sentAt,
    toEmail: r.toEmail,
    subject: r.subject,
    status: r.status,
    stepIndex: r.stepIndex,
    companyId: r.company.id,
    companyLabel:
      r.company.enseigne || r.company.nomSociete || r.company.siret || "—",
    sequenceName: r.sequence.name,
  }));
}

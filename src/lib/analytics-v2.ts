import type { PrismaClient } from "@prisma/client";
import type { StageDef } from "@/lib/stage-meta";

// Analytics v2 (P2.3): the time dimension. Everything here reads the
// StageChange transition log (lib/stage-history.ts) + Activity dates.
// The log starts empty on day one — callers show a "history builds from
// today" hint while these come back sparse; dwell falls back to createdAt.

export interface DwellDatum {
  stage: string;
  label: string;
  avgDays: number;
  count: number;
}

export interface TransitionDatum {
  label: string; // "Contacté → RDV obtenu"
  count: number;
}

export interface WeeklyDatum {
  name: string; // week-start "dd/MM"
  value: number;
}

export interface WinTrendDatum {
  name: string; // "juin 26"
  won: number;
  lost: number;
}

export interface AnalyticsV2 {
  dwell: DwellDatum[];
  transitions: TransitionDatum[];
  weeklyActivity: WeeklyDatum[];
  winTrend: WinTrendDatum[];
  hasHistory: boolean; // any real transition logged yet?
}

const DAY = 86_400_000;

export async function computeAnalyticsV2(
  prisma: PrismaClient,
  stageDefs: StageDef[],
): Promise<AnalyticsV2> {
  const now = Date.now();
  const labels = Object.fromEntries(stageDefs.map((s) => [s.value, s.label]));
  const since90 = new Date(now - 90 * DAY);
  const since12w = new Date(now - 12 * 7 * DAY);
  const since6m = new Date(now - 183 * DAY);
  const wonKeys = new Set(stageDefs.filter((s) => s.isWon).map((s) => s.value));
  const lostKeys = new Set(stageDefs.filter((s) => s.isLost).map((s) => s.value));

  const [companies, changes, activities] = await Promise.all([
    prisma.company.findMany({ select: { id: true, stage: true, createdAt: true } }),
    prisma.stageChange.findMany({
      orderBy: { at: "desc" },
      select: { companyId: true, from: true, to: true, at: true },
    }),
    prisma.activity.findMany({
      where: { date: { gte: since12w } },
      select: { date: true },
    }),
  ]);

  // — Dwell: time since each company ENTERED its current stage. The newest
  //   logged change per company IS that entry when its `to` matches the
  //   current stage; otherwise the move predates the log → fall back to
  //   createdAt (rough on day one, exact as history accrues).
  const latestChange = new Map<string, { to: string; at: Date }>();
  for (const ch of changes) {
    // newest-first, so keep only the first row seen per company
    if (!latestChange.has(ch.companyId)) latestChange.set(ch.companyId, ch);
  }
  const dwellAgg = new Map<string, { total: number; count: number }>();
  for (const c of companies) {
    const latest = latestChange.get(c.id);
    const entered = latest && latest.to === c.stage ? latest.at : c.createdAt;
    const days = Math.max(0, (now - +entered) / DAY);
    const agg = dwellAgg.get(c.stage) ?? { total: 0, count: 0 };
    agg.total += days;
    agg.count += 1;
    dwellAgg.set(c.stage, agg);
  }
  const dwell: DwellDatum[] = stageDefs
    .filter((s) => dwellAgg.has(s.value))
    .map((s) => {
      const agg = dwellAgg.get(s.value)!;
      return {
        stage: s.value,
        label: s.label,
        avgDays: Math.round(agg.total / agg.count),
        count: agg.count,
      };
    });

  // — Transitions (90 days), real moves only.
  const transitionCounts = new Map<string, number>();
  for (const ch of changes) {
    if (!ch.from || ch.at < since90) continue;
    const key = `${ch.from}→${ch.to}`;
    transitionCounts.set(key, (transitionCounts.get(key) ?? 0) + 1);
  }
  const transitions: TransitionDatum[] = [...transitionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => {
      const [from, to] = key.split("→");
      return {
        label: `${labels[from] ?? from} → ${labels[to] ?? to}`,
        count,
      };
    });

  // — Weekly activity volume (12 weeks, Monday-anchored).
  const weekStart = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const day = (x.getDay() + 6) % 7; // Monday = 0
    x.setDate(x.getDate() - day);
    return x;
  };
  const weeks: WeeklyDatum[] = [];
  const weekIndex = new Map<string, number>();
  const first = weekStart(new Date(since12w));
  for (let t = +first; t <= now; t += 7 * DAY) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    weekIndex.set(key, weeks.length);
    weeks.push({
      name: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      value: 0,
    });
  }
  for (const a of activities) {
    const key = weekStart(new Date(a.date)).toISOString().slice(0, 10);
    const i = weekIndex.get(key);
    if (i !== undefined) weeks[i].value += 1;
  }

  // — Win/lost trend (6 months) from transitions INTO a won/lost stage.
  const monthAgg = new Map<string, { won: number; lost: number }>();
  const monthKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  for (const ch of changes) {
    if (ch.at < since6m) continue;
    const isWon = wonKeys.has(ch.to);
    const isLost = lostKeys.has(ch.to);
    if (!isWon && !isLost) continue;
    const key = monthKey(ch.at);
    const agg = monthAgg.get(key) ?? { won: 0, lost: 0 };
    if (isWon) agg.won += 1;
    else agg.lost += 1;
    monthAgg.set(key, agg);
  }
  const MONTHS = [
    "janv.", "févr.", "mars", "avr.", "mai", "juin",
    "juil.", "août", "sept.", "oct.", "nov.", "déc.",
  ];
  const winTrend: WinTrendDatum[] = [...monthAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, agg]) => {
      const [y, m] = key.split("-").map(Number);
      return {
        name: `${MONTHS[m - 1]} ${String(y).slice(2)}`,
        won: agg.won,
        lost: agg.lost,
      };
    });

  return {
    dwell,
    transitions,
    weeklyActivity: weeks,
    winTrend,
    hasHistory: changes.some((ch) => ch.from !== null),
  };
}

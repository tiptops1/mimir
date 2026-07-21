import type {
  AdConnector,
  ConnectorCampaign,
  ConnectorCtx,
  ConnectorDailyMetric,
} from "./types";

// The deterministic demo provider. Metrics are a pure function of
// (externalId, day) via a seeded PRNG, so re-syncs upsert identical rows
// (idempotent) and tests can assert exact behavior. Campaign personality
// comes from an `archetype` in Campaign.config — seeded data, not code
// vocabulary: the constants below describe the demo provider's simulation,
// not any tenant's business.

export type DemoArchetype = "winner" | "steady" | "loser" | "fatiguing";

interface ArchetypeProfile {
  /** Fraction of dailyBudget actually spent per day (center of jitter). */
  pacing: number;
  cpc: number; // EUR per click — drives clicks from spend
  ctr: number; // clicks / impressions — drives displayed impressions
  cvr: number; // conversions / clicks
  /** Average conversion value in EUR (center of jitter). */
  avgValue: number;
}

const PROFILES: Record<DemoArchetype, ArchetypeProfile> = {
  // Expected ROAS = cvr * avgValue / cpc. Tuned so winners land ~3-5,
  // steady ~1.5-2, losers ~0.3-0.7 (before ±15% jitter).
  winner: { pacing: 0.92, cpc: 2.2, ctr: 0.04, cvr: 0.08, avgValue: 110 },
  steady: { pacing: 0.85, cpc: 2.5, ctr: 0.025, cvr: 0.04, avgValue: 110 },
  loser: { pacing: 0.99, cpc: 3.2, ctr: 0.012, cvr: 0.005, avgValue: 300 },
  // Starts winner-like, decays CTR/CVR over a 28-day cycle so the trailing
  // 7-day window visibly underperforms the 7 days before it.
  fatiguing: { pacing: 0.9, cpc: 2.0, ctr: 0.038, cvr: 0.07, avgValue: 110 },
};

/** FNV-1a 32-bit hash — stable numeric seed from a string. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — tiny deterministic PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Days since the Unix epoch for a "YYYY-MM-DD" key (UTC). */
function epochDays(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

export interface DemoCampaignInput {
  externalId: string;
  dailyBudget: number;
  config?: unknown;
}

function archetypeOf(config: unknown): DemoArchetype {
  const raw =
    config && typeof config === "object"
      ? (config as Record<string, unknown>).archetype
      : undefined;
  return raw === "winner" || raw === "loser" || raw === "fatiguing" ? raw : "steady";
}

/**
 * One deterministic metric row for (campaign, day). Pure — same inputs, same
 * output, always. Invariants: clicks <= impressions, conversions <= clicks,
 * all counters >= 0, spend <= dailyBudget.
 */
export function generateDailyMetric(
  campaign: DemoCampaignInput,
  day: string,
): ConnectorDailyMetric {
  const profile = PROFILES[archetypeOf(campaign.config)];
  const rand = mulberry32(fnv1a(`${campaign.externalId}|${day}`));

  // Fatigue: multiply CTR/CVR by a decay based on a 28-day cycle position so
  // the recent week is measurably worse than the one before, forever.
  let ctr = profile.ctr;
  let cvr = profile.cvr;
  if (archetypeOf(campaign.config) === "fatiguing") {
    const cyclePos = epochDays(day) % 28; // 0..27, decays as the cycle advances
    const decay = 1 - 0.6 * (cyclePos / 27); // 1.0 -> 0.4 across the cycle
    ctr *= decay;
    cvr *= decay;
  }

  const jitter = () => 0.85 + rand() * 0.3; // ±15%
  const spendEur = round2(campaign.dailyBudget * Math.min(1, profile.pacing * jitter()));
  const clicks = Math.max(0, Math.round((spendEur / profile.cpc) * jitter()));
  const impressions = Math.max(clicks, Math.round((clicks / ctr) * jitter()));
  const conversions = Math.min(clicks, Math.round(clicks * cvr * jitter()));
  const conversionValue = round2(conversions * profile.avgValue * jitter());

  return {
    externalId: campaign.externalId,
    day,
    spendEur,
    impressions,
    clicks,
    conversions,
    conversionValue,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const demoConnector: AdConnector = {
  provider: "demo",

  // Demo campaigns are seeded Campaign rows, not platform-discovered.
  async fetchCampaigns(): Promise<ConnectorCampaign[]> {
    return [];
  },

  async fetchDailyMetrics(
    _ctx: ConnectorCtx,
    campaigns: ConnectorCampaign[],
    days: string[],
  ): Promise<ConnectorDailyMetric[]> {
    return campaigns.flatMap((campaign) =>
      days.map((day) => generateDailyMetric(campaign, day)),
    );
  },
};

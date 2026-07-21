// Freyja connector contract (S25). One adapter per ad platform; the demo
// provider is the only implementation until real Google Ads / Meta access
// exists. The seam for real adapters is `ctx` (a future google_ads adapter
// fetches its credential Fireflies-style from the control-plane Integration
// row via ctx.tenantId) plus optional `applyChange` (push a decision to the
// platform) — the interface itself never changes.

export interface ConnectorCtx {
  tenantId: string;
}

export interface ConnectorCampaign {
  externalId: string;
  name: string;
  channel: string; // "search" | "social" | "display" (open vocab)
  status: string; // ACTIVE | PAUSED
  dailyBudget: number; // EUR
  bidStrategy?: string;
  config?: Record<string, unknown>;
}

export interface ConnectorDailyMetric {
  externalId: string;
  day: string; // "YYYY-MM-DD" (UTC)
  spendEur: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number; // EUR
}

export type CampaignChangeKind = "budget_change" | "campaign_pause" | "bid_adjust";

export interface CampaignChange {
  kind: CampaignChangeKind;
  externalId: string;
  /** kind-specific params: { newDailyBudget } | {} | { bidAdjustPct } */
  params: Record<string, number>;
}

export interface AdConnector {
  provider: string;
  /** Campaigns discovered platform-side. Demo returns [] (campaigns are seeded rows). */
  fetchCampaigns(ctx: ConnectorCtx): Promise<ConnectorCampaign[]>;
  /** One metric row per (campaign, day) for the requested days. */
  fetchDailyMetrics(
    ctx: ConnectorCtx,
    campaigns: ConnectorCampaign[],
    days: string[],
  ): Promise<ConnectorDailyMetric[]>;
  /** Push an approved decision to the platform. Absent on demo — executor falls through to the local write only. */
  applyChange?(ctx: ConnectorCtx, change: CampaignChange): Promise<void>;
}

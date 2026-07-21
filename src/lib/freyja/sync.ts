import type { PrismaClient } from "@prisma/client";
import { getConnector } from "./connectors";
import type { ConnectorCampaign } from "./connectors/types";
import { FREYJA_MODULE } from "./decide";
import { lastNDays } from "./metrics";

// Freyja metric sync (S25) — pulls per-day campaign metrics through the
// tenant's configured connector and upserts them on (day, campaignId).
// Runs synchronously inside /api/cron/freyja (forseti/thor snapshot posture:
// deterministic, no LLM, sub-second — no Inngest needed). Idempotent by
// construction: the demo provider is a pure function of (campaign, day), and
// real providers report the same historical numbers on re-pull.

export interface FreyjaSyncResult {
  provider: string;
  campaigns: number;
  rowsUpserted: number;
}

export async function runFreyjaSyncForTenant(
  prisma: PrismaClient,
  opts: { tenantId?: string; days?: number } = {},
): Promise<FreyjaSyncResult> {
  const days = opts.days ?? 3;

  const config = await prisma.freyjaConfig.upsert({
    where: { singleton: "default" },
    update: {},
    create: { singleton: "default" },
  });

  const connector = getConnector(config.provider);
  const ctx = { tenantId: opts.tenantId ?? "" };

  // Platform-discovered campaigns (demo returns []) are mirrored first so a
  // real adapter can create/refresh Campaign rows on every sync.
  const discovered = await connector.fetchCampaigns(ctx);
  for (const c of discovered) {
    await prisma.campaign.upsert({
      where: { provider_externalId: { provider: connector.provider, externalId: c.externalId } },
      update: { name: c.name, channel: c.channel, status: c.status, dailyBudget: c.dailyBudget, bidStrategy: c.bidStrategy },
      create: {
        provider: connector.provider,
        externalId: c.externalId,
        name: c.name,
        channel: c.channel,
        status: c.status,
        dailyBudget: c.dailyBudget,
        bidStrategy: c.bidStrategy,
        config: c.config as object | undefined,
      },
    });
  }

  const campaigns = await prisma.campaign.findMany({ where: { provider: config.provider } });
  const connectorCampaigns: ConnectorCampaign[] = campaigns.map((c) => ({
    externalId: c.externalId,
    name: c.name,
    channel: c.channel,
    status: c.status,
    dailyBudget: c.dailyBudget,
    bidStrategy: c.bidStrategy ?? undefined,
    config: (c.config as Record<string, unknown> | null) ?? undefined,
  }));

  const idByExternal = new Map(campaigns.map((c) => [c.externalId, c.id]));
  const metrics = await connector.fetchDailyMetrics(ctx, connectorCampaigns, lastNDays(days));

  let rowsUpserted = 0;
  for (const m of metrics) {
    const campaignId = idByExternal.get(m.externalId);
    if (!campaignId) continue;
    await prisma.campaignInsight.upsert({
      where: { day_campaignId: { day: m.day, campaignId } },
      update: {
        spendEur: m.spendEur,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
        conversionValue: m.conversionValue,
      },
      create: {
        day: m.day,
        campaignId,
        spendEur: m.spendEur,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
        conversionValue: m.conversionValue,
      },
    });
    rowsUpserted++;
  }

  await prisma.agentEvent.create({
    data: {
      module: FREYJA_MODULE,
      category: "sync",
      action: "completed",
      data: { provider: config.provider, campaigns: campaigns.length, rowsUpserted, days },
    },
  });

  return { provider: config.provider, campaigns: campaigns.length, rowsUpserted };
}

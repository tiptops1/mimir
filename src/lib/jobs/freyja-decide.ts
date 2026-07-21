import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "./client";
import { tenantPrismaById } from "./tenant";
import { getActivePrompt } from "@/lib/prompts";
import { proposeAction } from "@/lib/heimdallr/ledger";
import { aggregateInsights, lastNDays } from "@/lib/freyja/metrics";
import {
  DECISION_EXPIRY_DAYS,
  FREYJA_ACTION_TYPE,
  FREYJA_CATEGORIES,
  FREYJA_DECIDE_PROMPT_KEY,
  FREYJA_MODULE,
  SCAN_BATCH_LIMIT,
  checkBudgetDelta,
  draftCampaignDecision,
  flagCampaign,
} from "@/lib/freyja/decide";

// S25 — Freyja decision pipeline (thor-renewal.ts twin). Scan aggregates each
// ACTIVE campaign's trailing-14d insight, flags candidates deterministically
// (flagCampaign — the LLM decides *what to do*, never *whether to look*), and
// fans out one decision job per flagged campaign. Decide: Sonnet writes one
// structured decision, parsed fail-closed; kind:"none" is a legitimate
// decline. No HDS gate — the input is deterministic metric data, not free
// text (Thor posture). Payloads carry IDs only (S4 standing rule).
//
// Dedupe is CROSS-category: any PROPOSED freyja action on the campaign blocks
// a new proposal, so the agent can't stack conflicting decisions (e.g. a
// pause and a budget raise) on one campaign.
//
// The max-budget-delta guardrail fires here pre-propose (skip + event, no
// clamping — a clamped proposal isn't what the model reasoned about) and
// again in the executor against the live budget.

export const freyjaScanPayload = z.object({
  tenantId: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export const freyjaDecidePayload = z.object({
  tenantId: z.string().min(1),
  campaignId: z.string().min(1),
});

const ALL_CATEGORIES = Object.values(FREYJA_CATEGORIES);

export const freyjaScan = inngest.createFunction(
  {
    id: "freyja-campaign-scan",
    triggers: [{ event: "freyja/campaign.scan.requested" }],
    retries: 1,
  },
  async ({ event, step, runId }) => {
    const { tenantId, limit } = freyjaScanPayload.parse(event.data);

    const due = await step.run("find-flagged-campaigns", async () => {
      const prisma = await tenantPrismaById(tenantId);

      const configs = await prisma.autonomyConfig.findMany({
        where: { category: { in: ALL_CATEGORIES } },
        select: { category: true, level: true, paused: true },
      });
      const anyOn = configs.some((c) => c.level > 0 && !c.paused);
      const gateReason = !anyOn
        ? configs.some((c) => c.paused)
          ? "category_paused"
          : "category_off"
        : null;

      const freyjaConfig = await prisma.freyjaConfig.upsert({
        where: { singleton: "default" },
        update: {},
        create: { singleton: "default" },
      });

      const days14 = lastNDays(14);
      const campaigns = await prisma.campaign.findMany({
        where: { status: "ACTIVE" },
        include: {
          insights: {
            where: { day: { gte: days14[0] } },
            select: {
              day: true,
              spendEur: true,
              impressions: true,
              clicks: true,
              conversions: true,
              conversionValue: true,
            },
          },
        },
      });

      const flagged = campaigns.filter((c) => {
        const agg = aggregateInsights(c.insights);
        return (
          flagCampaign(agg, freyjaConfig, { dailyBudget: c.dailyBudget }).length > 0
        );
      });

      if (flagged.length === 0) return [];

      if (gateReason) {
        await prisma.agentEvent.create({
          data: {
            module: FREYJA_MODULE,
            category: "freyja",
            action: "skipped",
            runId,
            data: { job: "freyja-campaign-scan", reason: gateReason, pending: flagged.length },
          },
        });
        return [];
      }

      // Cross-category dedupe: any pending freyja proposal blocks the campaign.
      const pendingActions = await prisma.agentAction.findMany({
        where: {
          module: FREYJA_MODULE,
          entity: "CAMPAIGN",
          status: "PROPOSED",
        },
        select: { entityId: true },
      });
      const alreadyPending = new Set(pendingActions.map((a) => a.entityId));

      return flagged
        .filter((c) => !alreadyPending.has(c.id))
        .slice(0, limit ?? SCAN_BATCH_LIMIT)
        .map((c) => c.id);
    });

    if (due.length > 0) {
      await step.sendEvent(
        "enqueue-decisions",
        due.map((campaignId) => ({
          name: "freyja/campaign.decide.requested",
          data: { tenantId, campaignId },
        })),
      );
    }

    return { ok: true, enqueued: due.length };
  },
);

export const freyjaDecide = inngest.createFunction(
  {
    id: "freyja-campaign-decide",
    triggers: [{ event: "freyja/campaign.decide.requested" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const parsed = freyjaDecidePayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { tenantId, campaignId } = parsed.data;
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          entity: "CAMPAIGN",
          entityId: campaignId,
          data: { job: "freyja-campaign-decide", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId }) => {
    const { tenantId, campaignId } = freyjaDecidePayload.parse(event.data);

    // 1. Load the campaign, re-aggregate live, guard against a duplicate
    // concurrent proposal, re-check it still deserves a look.
    const loaded = await step.run("load-campaign-and-flag", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const days14 = lastNDays(14);
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          insights: {
            where: { day: { gte: days14[0] } },
            select: {
              day: true,
              spendEur: true,
              impressions: true,
              clicks: true,
              conversions: true,
              conversionValue: true,
            },
          },
        },
      });
      if (!campaign) throw new NonRetriableError(`Unknown campaign: ${campaignId}`);

      const pending = await prisma.agentAction.findFirst({
        where: {
          module: FREYJA_MODULE,
          entity: "CAMPAIGN",
          entityId: campaignId,
          status: "PROPOSED",
        },
        select: { id: true },
      });
      if (pending) {
        throw new NonRetriableError(
          `Campaign ${campaignId} already has a pending freyja proposal: ${pending.id}`,
        );
      }

      const freyjaConfig = await prisma.freyjaConfig.upsert({
        where: { singleton: "default" },
        update: {},
        create: { singleton: "default" },
      });

      const agg = aggregateInsights(campaign.insights);
      const flags = flagCampaign(agg, freyjaConfig, { dailyBudget: campaign.dailyBudget });
      if (flags.length === 0) {
        await prisma.agentEvent.create({
          data: {
            module: FREYJA_MODULE,
            category: "freyja",
            action: "skipped",
            runId,
            entity: "CAMPAIGN",
            entityId: campaignId,
            data: { job: "freyja-campaign-decide", reason: "no_longer_flagged" },
          },
        });
        return { skip: "no_longer_flagged" as const };
      }

      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_started",
          runId,
          entity: "CAMPAIGN",
          entityId: campaignId,
          data: { job: "freyja-campaign-decide", flags: flags.map((f) => f.key) },
        },
      });

      return {
        campaign: {
          campaignId: campaign.id,
          name: campaign.name,
          channel: campaign.channel,
          status: campaign.status,
          dailyBudget: campaign.dailyBudget,
          bidAdjustPct: campaign.bidAdjustPct,
        },
        agg,
        flags,
        dailySeries: campaign.insights
          .map((i) => ({
            day: i.day,
            spendEur: i.spendEur,
            clicks: i.clicks,
            conversions: i.conversions,
            conversionValue: i.conversionValue,
          }))
          .sort((a, b) => a.day.localeCompare(b.day)),
        maxBudgetDeltaPct: freyjaConfig.maxBudgetDeltaPct,
      };
    });
    if ("skip" in loaded) return { ok: true, outcome: "skipped", reason: loaded.skip };

    // 2. One structured decision (Sonnet via the metered router).
    const decided = await step.run("decide", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const prompt = await getActivePrompt(prisma, FREYJA_DECIDE_PROMPT_KEY);
      const decision = await draftCampaignDecision(
        prisma,
        prompt,
        loaded.campaign,
        loaded.agg,
        loaded.flags,
        loaded.dailySeries,
        loaded.maxBudgetDeltaPct,
      );
      if (decision === null) {
        throw new Error("Decision model unavailable — fail closed");
      }
      return { decision, promptKey: prompt.key, promptVersion: prompt.version };
    });

    // 3. Category gate + budget-delta guardrail + ledger proposal.
    const outcome = await step.run("propose", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const { decision } = decided;

      if (decision.kind === "none") {
        await prisma.agentEvent.create({
          data: {
            module: FREYJA_MODULE,
            category: "freyja",
            action: "skipped",
            runId,
            entity: "CAMPAIGN",
            entityId: loaded.campaign.campaignId,
            data: {
              job: "freyja-campaign-decide",
              reason: "agent_declined",
              rationale: decision.rationale,
            },
          },
        });
        return { outcome: "declined" as const };
      }

      const category = FREYJA_CATEGORIES[decision.kind];
      const config = await prisma.autonomyConfig.findUnique({
        where: { category },
        select: { level: true, paused: true },
      });
      if (!config || config.level === 0 || config.paused) {
        await prisma.agentEvent.create({
          data: {
            module: FREYJA_MODULE,
            category,
            action: "skipped",
            runId,
            entity: "CAMPAIGN",
            entityId: loaded.campaign.campaignId,
            data: {
              job: "freyja-campaign-decide",
              reason: config?.paused ? "category_paused" : "category_off",
              kind: decision.kind,
            },
          },
        });
        return { outcome: "gated" as const };
      }

      if (decision.kind === "budget_change") {
        const check = checkBudgetDelta(
          loaded.campaign.dailyBudget,
          decision.newDailyBudget,
          loaded.maxBudgetDeltaPct,
        );
        if (!check.ok) {
          await prisma.agentEvent.create({
            data: {
              module: FREYJA_MODULE,
              category,
              action: "skipped",
              runId,
              entity: "CAMPAIGN",
              entityId: loaded.campaign.campaignId,
              data: {
                job: "freyja-campaign-decide",
                reason: "budget_delta_cap",
                deltaPct: check.deltaPct,
                capPct: loaded.maxBudgetDeltaPct,
                newDailyBudget: decision.newDailyBudget,
              },
            },
          });
          return { outcome: "capped" as const };
        }
      }

      const action = await proposeAction(prisma, {
        module: FREYJA_MODULE,
        category,
        type: FREYJA_ACTION_TYPE,
        payload: {
          campaignId: loaded.campaign.campaignId,
          campaignName: loaded.campaign.name,
          kind: decision.kind,
          ...(decision.kind === "budget_change"
            ? { newDailyBudget: decision.newDailyBudget }
            : {}),
          ...(decision.kind === "bid_adjust" ? { bidAdjustPct: decision.bidAdjustPct } : {}),
          rationale: decision.rationale,
          evidence: {
            flags: loaded.flags,
            spend14dEur: loaded.agg.totals.spendEur,
            roas14d: loaded.agg.rates.roas,
            conversions14d: loaded.agg.totals.conversions,
            currentDailyBudget: loaded.campaign.dailyBudget,
          },
        },
        trigger: {
          kind: "insight_sweep",
          campaignId: loaded.campaign.campaignId,
          flags: loaded.flags.map((f) => f.key),
        },
        entity: "CAMPAIGN",
        entityId: loaded.campaign.campaignId,
        autonomyLevelAtProposal: config.level,
        promptKey: decided.promptKey,
        promptVersion: decided.promptVersion,
        reversible: true,
        expiresAt: new Date(Date.now() + DECISION_EXPIRY_DAYS * 86_400_000),
      });

      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_finished",
          runId,
          entity: "CAMPAIGN",
          entityId: loaded.campaign.campaignId,
          data: { job: "freyja-campaign-decide", outcome: "proposed", actionId: action.id },
        },
      });
      return { outcome: "proposed" as const, actionId: action.id };
    });

    return { ok: true, ...outcome };
  },
);

import type { AgentAction, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { executeAction, failAction } from "@/lib/heimdallr/ledger";
import { getConnector } from "./connectors";
import {
  FREYJA_ACTION_TYPE,
  FREYJA_MODULE,
  checkBudgetDelta,
  type FreyjaDecisionKind,
} from "./decide";

// S25 — Freyja executor/reverter, thor/executor.ts shape. "Execute" is a
// local Campaign write (status flip / budget change / bid note); undoData
// carries the prior values so revert restores them. Real ad platforms plug in
// through the connector's optional applyChange (see connectors/types.ts) —
// the demo provider has none, so the seam is a no-op today.
//
// budget_change re-checks the max-budget-delta cap against the LIVE campaign
// budget at execute time (not the one at proposal time): if a human edited
// the payload past the cap, or the budget moved since, the action lands
// FAILED with a guardrail_blocked event instead of executing.

export const decisionPayloadSchema = z.object({
  campaignId: z.string(),
  campaignName: z.string(),
  kind: z.enum(["budget_change", "campaign_pause", "bid_adjust"]),
  newDailyBudget: z.number().positive().optional(),
  bidAdjustPct: z.number().min(-50).max(50).optional(),
  rationale: z.string(),
  evidence: z
    .object({
      flags: z.array(z.object({ key: z.string(), label: z.string(), detail: z.string() })),
      spend14dEur: z.number(),
      roas14d: z.number().nullable(),
      conversions14d: z.number(),
      currentDailyBudget: z.number(),
    })
    .optional(),
});
export type DecisionPayload = z.infer<typeof decisionPayloadSchema>;

interface DecisionUndoData {
  prevStatus: string;
  prevDailyBudget: number;
  prevBidAdjustPct: number;
}

/** True for AgentAction rows this executor/reverter knows how to handle. */
export function isCampaignDecisionAction(action: Pick<AgentAction, "type">): boolean {
  return action.type === FREYJA_ACTION_TYPE;
}

/** APPROVED campaign.decision -> Campaign write, then AgentAction -> EXECUTED (or FAILED on guardrail). */
export async function executeCampaignDecision(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const parsed = decisionPayloadSchema.parse(action.editedPayload ?? action.payload);

  const campaign = await prisma.campaign.findUnique({ where: { id: parsed.campaignId } });
  if (!campaign) {
    await failAction(prisma, action.id, `Campagne introuvable (${parsed.campaignId})`);
    return;
  }

  if (parsed.kind === "budget_change") {
    if (parsed.newDailyBudget === undefined) {
      await failAction(prisma, action.id, "budget_change sans newDailyBudget");
      return;
    }
    const config = await prisma.freyjaConfig.findUnique({ where: { singleton: "default" } });
    const capPct = config?.maxBudgetDeltaPct ?? 20;
    const check = checkBudgetDelta(campaign.dailyBudget, parsed.newDailyBudget, capPct);
    if (!check.ok) {
      await failAction(
        prisma,
        action.id,
        `Refusé : variation de budget de ${check.deltaPct.toFixed(0)} % au-delà du plafond (${capPct} %)`,
      );
      await prisma.agentEvent.create({
        data: {
          module: FREYJA_MODULE,
          category: action.category,
          action: "guardrail_blocked",
          actionId: action.id,
          entity: "CAMPAIGN",
          entityId: campaign.id,
          data: { deltaPct: check.deltaPct, capPct, newDailyBudget: parsed.newDailyBudget },
        },
      });
      return;
    }
  }

  // Real-platform seam: a connector with applyChange pushes the decision to
  // the ad platform before the local mirror write. Demo has none.
  const connector = getConnector(campaign.provider);
  if (connector.applyChange) {
    await connector.applyChange(
      { tenantId: "" }, // ctx.tenantId wired when a real adapter lands (needs SA plumbing)
      {
        kind: parsed.kind as FreyjaDecisionKind,
        externalId: campaign.externalId,
        params:
          parsed.kind === "budget_change"
            ? { newDailyBudget: parsed.newDailyBudget! }
            : parsed.kind === "bid_adjust"
              ? { bidAdjustPct: parsed.bidAdjustPct ?? 0 }
              : {},
      },
    );
  }

  const undoData: DecisionUndoData = {
    prevStatus: campaign.status,
    prevDailyBudget: campaign.dailyBudget,
    prevBidAdjustPct: campaign.bidAdjustPct,
  };

  await prisma.campaign.update({
    where: { id: campaign.id },
    data:
      parsed.kind === "budget_change"
        ? { dailyBudget: parsed.newDailyBudget! }
        : parsed.kind === "campaign_pause"
          ? { status: "PAUSED" }
          : { bidAdjustPct: parsed.bidAdjustPct ?? 0 },
  });

  await executeAction(prisma, action.id, { undoData: { ...undoData } });
}

/** EXECUTED -> UNDONE campaign.decision — restores the prior Campaign values. */
export async function revertCampaignDecision(
  prisma: PrismaClient,
  action: AgentAction,
): Promise<void> {
  const undoData = action.undoData as unknown as DecisionUndoData | null;
  if (!undoData) return;
  const parsed = decisionPayloadSchema.safeParse(action.editedPayload ?? action.payload);
  if (!parsed.success) return;
  await prisma.campaign
    .update({
      where: { id: parsed.data.campaignId },
      data: {
        status: undoData.prevStatus,
        dailyBudget: undoData.prevDailyBudget,
        bidAdjustPct: undoData.prevBidAdjustPct,
      },
    })
    .catch(() => {
      // Campaign gone (e.g. reseeded) — undo is idempotent, nothing else to do.
    });
}

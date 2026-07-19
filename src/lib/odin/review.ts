import type { PrismaClient } from "@prisma/client";
import { getActivePrompt } from "@/lib/prompts";
import { proposeAction } from "@/lib/heimdallr/ledger";
import {
  buildReviewInput,
  DIRECTIVE_EXPIRY_DAYS,
  ODIN_CATEGORY,
  ODIN_MODULE,
  ODIN_ACTION_TYPE,
  ODIN_REVIEW_CATEGORY,
  ODIN_REVIEW_PROMPT_KEY,
  reviewSnapshot,
} from "./draft";

// S21 — Odin's own reasoning loop (odin.md §5): daily cron, no Inngest,
// single Sonnet synthesis over stats that already exist. Called directly
// from /api/cron/odin/route.ts, same shape as Forseti's
// runComplianceSnapshotForTenant. Zero or one proposeAction call per run —
// the review can legitimately decide nothing needs to change.

export interface OdinReviewResult {
  proposed: boolean;
  actionId?: string;
  directiveKey?: string;
}

/** One tenant's daily Odin review. Called from the cron route per tenant. */
export async function reviewAndProposeDirective(prisma: PrismaClient): Promise<OdinReviewResult> {
  const config = await prisma.autonomyConfig.findUnique({
    where: { category: ODIN_CATEGORY },
    select: { level: true },
  });

  const input = await buildReviewInput(prisma);
  const prompt = await getActivePrompt(prisma, ODIN_REVIEW_PROMPT_KEY);
  const draft = await reviewSnapshot(prisma, prompt, input);

  if (!draft) {
    await prisma.agentEvent.create({
      data: {
        module: ODIN_MODULE,
        category: ODIN_REVIEW_CATEGORY,
        action: "ran",
        data: { proposed: false },
      },
    });
    return { proposed: false };
  }

  const action = await proposeAction(prisma, {
    module: ODIN_MODULE,
    category: ODIN_CATEGORY,
    type: ODIN_ACTION_TYPE,
    payload: draft,
    trigger: { kind: "cron" },
    autonomyLevelAtProposal: config?.level ?? 0,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    reversible: true,
    expiresAt: new Date(Date.now() + DIRECTIVE_EXPIRY_DAYS * 86_400_000),
  });

  return { proposed: true, actionId: action.id, directiveKey: draft.key };
}

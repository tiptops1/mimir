import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { approveAction, proposeAction, undoAction } from "@/lib/heimdallr/ledger";
import { executeContentPiece, revertContentPiece } from "@/lib/bragi/executor";
import { getActivePrompt } from "@/lib/prompts";
import { isVectorIndexReady } from "@/lib/rag/vector-index";
import { retrieve } from "@/lib/rag/retrieve";
import { isSlotDue, isoWeekday, periodKeyFor } from "@/lib/bragi/calendar";
import {
  BRAGI_ACTION_TYPE,
  BRAGI_CATEGORY,
  BRAGI_MODULE,
  buildContentRetrievalQuery,
  CONTENT_DRAFT_EXPIRY_DAYS,
  draftContentPiece,
  promptKeyForChannel,
  renderBrandVoiceBlock,
  type ContentSlotInput,
} from "@/lib/bragi/draft";

// S18 dev verification script — exercises the real Bragi pipeline in-process
// (same library calls the Inngest job makes, without the queue) against
// crm_demo: create a scratch weekly ContentSlot due today, confirm scan
// idempotence (isSlotDue flips false after marking the period), propose +
// approve a content draft (version 1), regenerate + approve again for the
// SAME period (version 2 supersedes version 1), then undo version 2 (version
// 1 restored). Cleans up all scratch data after.
//
//   npx tsx scripts/bragi/generate-demo-content.ts

const TOPIC = "Vérification S18 — conseil assurance flotte auto";
const BRIEF =
  "Un conseil concret pour un dirigeant de TPE/PME sur l'assurance de sa flotte " +
  "automobile professionnelle : garanties essentielles, bonnes pratiques de " +
  "déclaration de sinistre, points de vigilance au renouvellement.";

interface DraftedOnce {
  actionId: string;
  passageCount: number;
}

async function draftOneVersion(
  prisma: PrismaClient,
  slotId: string,
  slot: ContentSlotInput & { periodKey: string; brandVoiceKey: string; channel: string },
): Promise<DraftedOnce> {
  const voice = await prisma.brandVoice.findFirst({
    where: { key: slot.brandVoiceKey, active: true },
    orderBy: { version: "desc" },
  });
  if (!voice) throw new Error("BrandVoice not seeded — run npm run config:seed");

  const indexReady = await isVectorIndexReady(prisma);
  const passages = indexReady
    ? await retrieve(prisma, buildContentRetrievalQuery(slot), { limit: 4 })
    : [];

  const prompt = await getActivePrompt(prisma, promptKeyForChannel(slot.channel));
  const draft = await draftContentPiece(prisma, prompt, renderBrandVoiceBlock(voice), slot, passages);
  console.log(`  draft: ${draft ? "ok" : "FAILED (null)"}`);
  if (!draft) throw new Error("Draft model unavailable — cannot verify");

  const config = await prisma.autonomyConfig.findUnique({
    where: { category: BRAGI_CATEGORY },
    select: { level: true },
  });
  const action = await proposeAction(prisma, {
    module: BRAGI_MODULE,
    category: BRAGI_CATEGORY,
    type: BRAGI_ACTION_TYPE,
    payload: {
      channel: slot.channel,
      periodKey: slot.periodKey,
      topic: slot.topic,
      title: draft.title,
      body: draft.body,
      brandVoiceKey: slot.brandVoiceKey,
      brandVoiceVersion: voice.version,
    },
    sources: passages,
    trigger: { kind: "manual", slotId, periodKey: slot.periodKey },
    entity: "CONTENT_SLOT",
    entityId: slotId,
    autonomyLevelAtProposal: config?.level ?? 0,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    reversible: true,
    expiresAt: new Date(Date.now() + CONTENT_DRAFT_EXPIRY_DAYS * 86_400_000),
  });
  console.log(`  -> PROPOSED action ${action.id}`);
  return { actionId: action.id, passageCount: passages.length };
}

async function main() {
  const prisma = new PrismaClient();
  let slotId: string | undefined;
  let raisedLevel = false;

  try {
    const now = new Date();
    const weekday = isoWeekday(now);

    const slot = await prisma.contentSlot.create({
      data: {
        key: `bragi.slot.scratch-verify-${now.getTime()}`,
        label: "Vérification S18 (scratch)",
        channel: "linkedin_post",
        topic: TOPIC,
        brief: BRIEF,
        cadence: "weekly",
        weekday,
        brandVoiceKey: "bragi.brand_voice.default",
        active: true,
      },
    });
    slotId = slot.id;
    console.log(`Created scratch ContentSlot ${slot.id} (weekday=${weekday})`);

    const config = await prisma.autonomyConfig.findUnique({ where: { category: BRAGI_CATEGORY } });
    if (!config) throw new Error("bragi.content AutonomyConfig not seeded — run npm run config:seed");
    if (config.level === 0) {
      await prisma.autonomyConfig.update({ where: { category: BRAGI_CATEGORY }, data: { level: 1 } });
      raisedLevel = true;
      console.log("Raised bragi.content AutonomyConfig level 0 -> 1 for this run");
    }

    const periodKey = periodKeyFor(slot.cadence, now);
    const slotInput = {
      channel: slot.channel,
      topic: slot.topic,
      brief: slot.brief,
      periodKey,
      brandVoiceKey: slot.brandVoiceKey,
    };

    console.log("\n== Scan idempotence pre-check ==");
    const dueBefore = isSlotDue(
      { active: true, cadence: slot.cadence, weekday: slot.weekday, dayOfMonth: slot.dayOfMonth, lastGeneratedPeriod: null },
      now,
    );
    console.log(`  isSlotDue (never generated) = ${dueBefore} (expect true)`);
    if (!dueBefore) throw new Error("Scratch slot unexpectedly not due — scheduling bug");

    console.log("\n== Generation 1 (version 1) ==");
    const gen1 = await draftOneVersion(prisma, slotId, slotInput);
    await prisma.contentSlot.update({
      where: { id: slotId },
      data: { lastGeneratedPeriod: periodKey, lastGeneratedAt: new Date() },
    });
    const dueAfter = isSlotDue(
      { active: true, cadence: slot.cadence, weekday: slot.weekday, dayOfMonth: slot.dayOfMonth, lastGeneratedPeriod: periodKey },
      now,
    );
    console.log(`  isSlotDue (after marking period) = ${dueAfter} (expect false — idempotence proven)`);

    const approved1 = await approveAction(prisma, gen1.actionId, { decidedBy: undefined });
    await executeContentPiece(prisma, approved1);
    const piece1 = await prisma.contentPiece.findFirst({
      where: { entity: "CONTENT_SLOT", entityId: slotId, periodKey, version: 1 },
    });
    console.log(`  ContentPiece v1 status=${piece1?.status} (expect ACTIVE), sources=${gen1.passageCount}`);

    console.log("\n== Generation 2 (same period, version 2 supersedes version 1) ==");
    const gen2 = await draftOneVersion(prisma, slotId, slotInput);
    const approved2 = await approveAction(prisma, gen2.actionId, { decidedBy: undefined });
    await executeContentPiece(prisma, approved2);
    const piece1After = await prisma.contentPiece.findFirst({
      where: { entity: "CONTENT_SLOT", entityId: slotId, periodKey, version: 1 },
    });
    const piece2 = await prisma.contentPiece.findFirst({
      where: { entity: "CONTENT_SLOT", entityId: slotId, periodKey, version: 2 },
    });
    console.log(`  ContentPiece v1 status=${piece1After?.status} (expect SUPERSEDED)`);
    console.log(`  ContentPiece v2 status=${piece2?.status} (expect ACTIVE)`);

    console.log("\n== Undo version 2 ==");
    const undone2 = await undoAction(prisma, gen2.actionId, config.undoWindowMinutes);
    await revertContentPiece(prisma, undone2);
    const piece1Restored = await prisma.contentPiece.findFirst({
      where: { entity: "CONTENT_SLOT", entityId: slotId, periodKey, version: 1 },
    });
    const piece2Undone = await prisma.contentPiece.findFirst({
      where: { entity: "CONTENT_SLOT", entityId: slotId, periodKey, version: 2 },
    });
    console.log(`  ContentPiece v1 status=${piece1Restored?.status} (expect ACTIVE)`);
    console.log(`  ContentPiece v2 status=${piece2Undone?.status} (expect UNDONE)`);

    console.log("\nAll checks completed.");
  } finally {
    if (slotId) {
      console.log("\nCleaning up scratch data...");
      await prisma.contentPiece.deleteMany({ where: { entity: "CONTENT_SLOT", entityId: slotId } });
      await prisma.agentEvent.deleteMany({ where: { entity: "CONTENT_SLOT", entityId: slotId } });
      await prisma.agentAction.deleteMany({ where: { entity: "CONTENT_SLOT", entityId: slotId } });
      await prisma.contentSlot.delete({ where: { id: slotId } });
      console.log("  removed ContentPiece/AgentAction/AgentEvent rows + scratch ContentSlot");
    }
    if (raisedLevel) {
      await prisma.autonomyConfig.update({ where: { category: BRAGI_CATEGORY }, data: { level: 0 } });
      console.log("  restored bragi.content AutonomyConfig level to 0");
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { approveAction, proposeAction, undoAction } from "@/lib/heimdallr/ledger";
import { executeRcaDocument, revertRcaDocument } from "@/lib/muninn/executor";
import { getActivePrompt } from "@/lib/prompts";
import { isVectorIndexReady } from "@/lib/rag/vector-index";
import { retrieve } from "@/lib/rag/retrieve";
import {
  buildSectionRetrievalQuery,
  draftRcaSection,
  MUNINN_ACTION_TYPE,
  MUNINN_CATEGORY,
  MUNINN_DEFAULT_TEMPLATE_KEY,
  MUNINN_MODULE,
  RCA_DRAFT_EXPIRY_DAYS,
  type IncidentActivityInput,
  type RcaSectionResult,
  type RcaTemplateSection,
} from "@/lib/muninn/draft";

// S16 dev verification script — exercises the real Muninn pipeline in-process
// (same library calls the Inngest job makes, without the queue) against
// crm_demo: propose an RCA draft for a scratch incident Activity, approve it
// (version 1), regenerate + approve again (version 2 supersedes version 1),
// then undo version 2 (version 1 restored). Cleans up all scratch data after.
//
//   npx tsx scripts/muninn/generate-demo-rca.ts

const INCIDENT_TEXT =
  "Le client signale un retard de plus de trois semaines dans le traitement " +
  "d'un avenant de modification de garanties sur son contrat flotte auto. " +
  "Aucune relance n'a été envoyée par le cabinet depuis la demande initiale. " +
  "Le client menace de résilier son contrat s'il n'a pas de nouvelles sous 48h.";

async function draftOneVersion(
  prisma: PrismaClient,
  activityId: string,
  incident: IncidentActivityInput,
): Promise<string> {
  const templateRow = await prisma.rcaTemplate.findFirst({
    where: { key: MUNINN_DEFAULT_TEMPLATE_KEY, active: true },
    orderBy: { version: "desc" },
  });
  if (!templateRow) throw new Error("RcaTemplate not seeded — run npm run config:seed");
  const sections = templateRow.sections as unknown as RcaTemplateSection[];
  const indexReady = await isVectorIndexReady(prisma);

  const results: RcaSectionResult[] = [];
  const sourcesById = new Map<string, { docId: string; chunkId: string; text: string; score: number }>();
  for (const section of sections) {
    const passages = indexReady
      ? await retrieve(prisma, buildSectionRetrievalQuery(incident, section.label), { limit: 4 })
      : [];
    for (const p of passages) sourcesById.set(p.chunkId, p);
    const prompt = await getActivePrompt(prisma, section.promptKey);
    const draft = await draftRcaSection(prisma, prompt, incident, passages);
    results.push({
      key: section.key,
      label: section.label,
      content: draft?.content ?? null,
      promptKey: prompt.key,
      promptVersion: prompt.version,
    });
    console.log(`  [${section.key}] ${draft ? "ok" : "FAILED (null)"}`);
  }

  const config = await prisma.autonomyConfig.findUnique({
    where: { category: MUNINN_CATEGORY },
    select: { level: true },
  });
  const action = await proposeAction(prisma, {
    module: MUNINN_MODULE,
    category: MUNINN_CATEGORY,
    type: MUNINN_ACTION_TYPE,
    payload: { templateKey: templateRow.key, templateVersion: templateRow.version, sections: results },
    sources: Array.from(sourcesById.values()),
    trigger: { kind: "manual", activityId },
    entity: "ACTIVITY",
    entityId: activityId,
    autonomyLevelAtProposal: config?.level ?? 0,
    reversible: true,
    expiresAt: new Date(Date.now() + RCA_DRAFT_EXPIRY_DAYS * 86_400_000),
  });
  console.log(`  -> PROPOSED action ${action.id}`);
  return action.id;
}

async function main() {
  const prisma = new PrismaClient();
  let activityId: string | undefined;
  let raisedLevel = false;

  try {
    const company = await prisma.company.findFirst({ select: { id: true } });
    if (!company) throw new Error("No company in crm_demo — run npm run tenant:seed-demo first");

    const activity = await prisma.activity.create({
      data: {
        type: "NOTE",
        note: "Réclamation client — avenant en retard (scratch S16 verification)",
        body: INCIDENT_TEXT,
        aiSummary: "Réclamation : avenant en retard, menace de résiliation.",
        sentiment: "NEGATIF",
        companyId: company.id,
      },
    });
    activityId = activity.id;
    console.log(`Created scratch Activity ${activity.id}`);

    const config = await prisma.autonomyConfig.findUnique({ where: { category: MUNINN_CATEGORY } });
    if (!config) throw new Error("muninn.rca_doc AutonomyConfig not seeded — run npm run config:seed");
    if (config.level === 0) {
      await prisma.autonomyConfig.update({ where: { category: MUNINN_CATEGORY }, data: { level: 1 } });
      raisedLevel = true;
      console.log("Raised muninn.rca_doc AutonomyConfig level 0 -> 1 for this run");
    }

    const incident: IncidentActivityInput = {
      summary: activity.aiSummary ?? "",
      body: activity.body ?? "",
      sentiment: activity.sentiment,
    };

    console.log("\n== Generation 1 (version 1) ==");
    const actionId1 = await draftOneVersion(prisma, activityId, incident);
    const approved1 = await approveAction(prisma, actionId1, { decidedBy: undefined });
    await executeRcaDocument(prisma, approved1);
    const doc1 = await prisma.rcaDocument.findFirst({
      where: { entity: "ACTIVITY", entityId: activityId, version: 1 },
    });
    console.log(`  RcaDocument v1 status=${doc1?.status} (expect ACTIVE)`);

    console.log("\n== Generation 2 (version 2, supersedes version 1) ==");
    const actionId2 = await draftOneVersion(prisma, activityId, incident);
    const approved2 = await approveAction(prisma, actionId2, { decidedBy: undefined });
    await executeRcaDocument(prisma, approved2);
    const doc1After = await prisma.rcaDocument.findFirst({
      where: { entity: "ACTIVITY", entityId: activityId, version: 1 },
    });
    const doc2 = await prisma.rcaDocument.findFirst({
      where: { entity: "ACTIVITY", entityId: activityId, version: 2 },
    });
    console.log(`  RcaDocument v1 status=${doc1After?.status} (expect SUPERSEDED)`);
    console.log(`  RcaDocument v2 status=${doc2?.status} (expect ACTIVE)`);

    console.log("\n== Undo version 2 ==");
    const undone2 = await undoAction(prisma, actionId2, config.undoWindowMinutes);
    await revertRcaDocument(prisma, undone2);
    const doc1Restored = await prisma.rcaDocument.findFirst({
      where: { entity: "ACTIVITY", entityId: activityId, version: 1 },
    });
    const doc2Undone = await prisma.rcaDocument.findFirst({
      where: { entity: "ACTIVITY", entityId: activityId, version: 2 },
    });
    console.log(`  RcaDocument v1 status=${doc1Restored?.status} (expect ACTIVE)`);
    console.log(`  RcaDocument v2 status=${doc2Undone?.status} (expect UNDONE)`);

    console.log("\nAll checks completed.");
  } finally {
    if (activityId) {
      console.log("\nCleaning up scratch data...");
      await prisma.rcaDocument.deleteMany({ where: { entity: "ACTIVITY", entityId: activityId } });
      await prisma.agentEvent.deleteMany({ where: { entity: "ACTIVITY", entityId: activityId } });
      await prisma.agentAction.deleteMany({ where: { entity: "ACTIVITY", entityId: activityId } });
      await prisma.activity.delete({ where: { id: activityId } });
      console.log("  removed RcaDocument/AgentAction/AgentEvent rows + scratch Activity");
    }
    if (raisedLevel) {
      await prisma.autonomyConfig.update({ where: { category: MUNINN_CATEGORY }, data: { level: 0 } });
      console.log("  restored muninn.rca_doc AutonomyConfig level to 0");
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

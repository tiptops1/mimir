import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { approveAction, proposeAction, undoAction } from "@/lib/heimdallr/ledger";
import { executeRenewalOutreach, revertRenewalOutreach } from "@/lib/thor/executor";
import { getActivePrompt } from "@/lib/prompts";
import { isVectorIndexReady } from "@/lib/rag/vector-index";
import { retrieve } from "@/lib/rag/retrieve";
import { evaluateCompanyHealth, type CompanyHealthInput } from "@/lib/thor/health";
import {
  buildRenewalRetrievalQuery,
  draftRenewalOutreach,
  RENEWAL_DRAFT_EXPIRY_DAYS,
  THOR_MODULE,
  THOR_RENEWAL_ACTION_TYPE,
  THOR_RENEWAL_CATEGORY,
  THOR_RENEWAL_PROMPT_KEY,
} from "@/lib/thor/renewal";

// S22b dev verification script — exercises the real Thor renewal pipeline
// in-process (same library calls the Inngest job makes, without the queue)
// against crm_demo: pick a real at-risk/critical company (S22a's seed keeps
// a real mix), draft + propose a retention email, edit-then-approve it
// (proves wasEdited), execute (creates the Task), then undo (deletes it).
// Cleans up all scratch AgentAction/AgentEvent rows after; the AutonomyConfig
// level is restored if this run raised it.
//
//   npx tsx scripts/thor/generate-demo-renewal.ts

async function main() {
  const prisma = new PrismaClient();
  let actionId: string | undefined;
  let raisedLevel = false;

  try {
    const companies = await prisma.company.findMany({
      select: {
        id: true,
        nomSociete: true,
        enseigne: true,
        siret: true,
        dernierContact: true,
        deals: { select: { status: true, isPrimary: true, closeDate: true, updatedAt: true } },
        activities: {
          orderBy: { date: "desc" },
          take: 1,
          select: { sentiment: true, date: true },
        },
      },
    });

    const target = companies
      .map((c) => {
        const latestActivity = c.activities[0] ?? null;
        const primaryOpenDeal = c.deals.find((d) => d.isPrimary && d.status === "OPEN") ?? null;
        const input: CompanyHealthInput = {
          id: c.id,
          name: c.nomSociete ?? c.enseigne ?? c.siret,
          dernierContact: c.dernierContact,
          latestActivitySentiment: latestActivity?.sentiment ?? null,
          latestActivityDate: latestActivity?.date ?? null,
          wonDeals: c.deals.filter((d) => d.status === "WON").map((d) => ({ closeDate: d.closeDate })),
          primaryOpenDeal: primaryOpenDeal ? { updatedAt: primaryOpenDeal.updatedAt } : null,
        };
        return { company: c, health: evaluateCompanyHealth(input) };
      })
      .find(({ health }) => health.band === "at_risk" || health.band === "critical");

    if (!target) throw new Error("No at_risk/critical company in crm_demo — run npm run tenant:seed-demo");
    const { company, health } = target;
    const companyName = company.nomSociete ?? company.enseigne ?? company.siret;
    console.log(`Target company: ${companyName} (${company.id}) — band=${health.band}, score=${health.score}`);
    console.log(`  signals: ${health.signals.map((s) => s.label).join(", ")}`);

    const config = await prisma.autonomyConfig.findUnique({ where: { category: THOR_RENEWAL_CATEGORY } });
    if (!config) throw new Error("thor.renewal AutonomyConfig not seeded — run npm run config:seed");
    if (config.level === 0) {
      await prisma.autonomyConfig.update({ where: { category: THOR_RENEWAL_CATEGORY }, data: { level: 1 } });
      raisedLevel = true;
      console.log("Raised thor.renewal AutonomyConfig level 0 -> 1 for this run");
    }

    console.log("\n== Retrieve + draft ==");
    const indexReady = await isVectorIndexReady(prisma);
    const companyInput = { companyId: company.id, companyName };
    const healthInput = { score: health.score, band: health.band, signals: health.signals };
    const passages = indexReady
      ? await retrieve(prisma, buildRenewalRetrievalQuery(companyInput, healthInput), { limit: 4 })
      : [];
    console.log(`  passages: ${passages.length}`);

    const prompt = await getActivePrompt(prisma, THOR_RENEWAL_PROMPT_KEY);
    const draft = await draftRenewalOutreach(prisma, prompt, companyInput, healthInput, passages);
    console.log(`  draft: ${draft ? "ok" : "FAILED (null)"}`);
    if (!draft) throw new Error("Draft model unavailable — cannot verify");
    console.log(`  subject: ${draft.subject}`);

    console.log("\n== Propose ==");
    const action = await proposeAction(prisma, {
      module: THOR_MODULE,
      category: THOR_RENEWAL_CATEGORY,
      type: THOR_RENEWAL_ACTION_TYPE,
      payload: {
        companyId: company.id,
        companyName,
        band: health.band,
        score: health.score,
        signals: health.signals,
        subject: draft.subject,
        body: draft.body,
      },
      sources: passages,
      trigger: { kind: "health_sweep", companyId: company.id, band: health.band },
      entity: "COMPANY",
      entityId: company.id,
      autonomyLevelAtProposal: config.level === 0 ? 1 : config.level,
      promptKey: prompt.key,
      promptVersion: prompt.version,
      reversible: true,
      expiresAt: new Date(Date.now() + RENEWAL_DRAFT_EXPIRY_DAYS * 86_400_000),
    });
    actionId = action.id;
    console.log(`  -> PROPOSED action ${action.id}`);

    console.log("\n== Edit-then-approve ==");
    const editedSubject = `[Vérifié] ${draft.subject}`;
    const approved = await approveAction(prisma, action.id, {
      decidedBy: undefined,
      editedPayload: {
        companyId: company.id,
        companyName,
        band: health.band,
        score: health.score,
        signals: health.signals,
        subject: editedSubject,
        body: draft.body,
      },
    });
    console.log(`  status=${approved.status} (expect APPROVED), wasEdited=${approved.wasEdited} (expect true)`);

    console.log("\n== Execute ==");
    await executeRenewalOutreach(prisma, approved);
    const executed = await prisma.agentAction.findUniqueOrThrow({ where: { id: action.id } });
    const undoData = executed.undoData as unknown as { taskId: string };
    const task = await prisma.task.findUnique({ where: { id: undoData.taskId } });
    console.log(`  status=${executed.status} (expect EXECUTED)`);
    console.log(`  Task created: id=${task?.id}, type=${task?.type}, source=${task?.source}, title=${task?.title}`);

    console.log("\n== Undo ==");
    const undone = await undoAction(prisma, action.id, config.undoWindowMinutes);
    await revertRenewalOutreach(prisma, undone);
    const taskAfterUndo = await prisma.task.findUnique({ where: { id: undoData.taskId } });
    console.log(`  status=${undone.status} (expect UNDONE)`);
    console.log(`  Task after undo: ${taskAfterUndo ? "STILL EXISTS (bug)" : "deleted (expect this)"}`);

    console.log("\nAll checks completed.");
  } finally {
    if (actionId) {
      console.log("\nCleaning up scratch data...");
      await prisma.agentEvent.deleteMany({ where: { actionId } });
      await prisma.agentAction.deleteMany({ where: { id: actionId } });
      console.log("  removed the scratch AgentAction + its AgentEvent rows (Task was already deleted by undo)");
    }
    if (raisedLevel) {
      await prisma.autonomyConfig.update({ where: { category: THOR_RENEWAL_CATEGORY }, data: { level: 0 } });
      console.log("  restored thor.renewal AutonomyConfig level to 0");
    }
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

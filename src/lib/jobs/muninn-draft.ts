import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "./client";
import { tenantPrismaById } from "./tenant";
import {
  classifyBatch,
  getClassifierPrompt,
  partitionByVerdict,
  sha256,
} from "@/lib/rag/classify";
import { getActivePrompt } from "@/lib/prompts";
import { isVectorIndexReady } from "@/lib/rag/vector-index";
import { retrieve, type Passage } from "@/lib/rag/retrieve";
import { proposeAction } from "@/lib/heimdallr/ledger";
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

// S16 — Muninn RCA-doc pipeline. Manually triggered per Activity (no ticket
// model exists in the CRM baseline to scan, unlike Huginn's inbox sweep): HDS
// gate (S11 classifier, fail closed) -> per-section retrieve (S12) + draft
// (Sonnet) -> proposeAction (PROPOSED only). Payload carries IDs only (S4
// standing rule). No terminal Activity marker — duplicate-generation guard is
// the ledger itself (a PROPOSED muninn.rca_doc row already existing for this
// entityId blocks a second one).

export const muninnDraftPayload = z.object({
  tenantId: z.string().min(1),
  activityId: z.string().min(1),
});

interface LoadedIncident extends IncidentActivityInput {
  companyId: string | null;
}

export const muninnDraftRca = inngest.createFunction(
  {
    id: "muninn-draft-rca",
    triggers: [{ event: "muninn/rca.draft.requested" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const parsed = muninnDraftPayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { tenantId, activityId } = parsed.data;
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          entity: "ACTIVITY",
          entityId: activityId,
          data: { job: "muninn-draft-rca", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId }) => {
    const { tenantId, activityId } = muninnDraftPayload.parse(event.data);

    // 1. Load the activity + guard against a duplicate concurrent generation.
    const incident = await step.run("load-context", async (): Promise<
      LoadedIncident | { skip: string }
    > => {
      const prisma = await tenantPrismaById(tenantId);
      const row = await prisma.activity.findUnique({
        where: { id: activityId },
        select: {
          note: true,
          body: true,
          aiSummary: true,
          sentiment: true,
          companyId: true,
        },
      });
      if (!row) throw new NonRetriableError(`Unknown activity: ${activityId}`);

      const pending = await prisma.agentAction.findFirst({
        where: {
          module: MUNINN_MODULE,
          category: MUNINN_CATEGORY,
          entity: "ACTIVITY",
          entityId: activityId,
          status: "PROPOSED",
        },
        select: { id: true },
      });
      if (pending) {
        throw new NonRetriableError(
          `Activity ${activityId} already has a pending RCA proposal: ${pending.id}`,
        );
      }

      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_started",
          runId,
          entity: "ACTIVITY",
          entityId: activityId,
          data: { job: "muninn-draft-rca" },
        },
      });

      const body = row.body ?? row.note ?? "";
      if (body.trim().length === 0) {
        await prisma.agentEvent.create({
          data: {
            module: MUNINN_MODULE,
            category: MUNINN_CATEGORY,
            action: "skipped",
            runId,
            entity: "ACTIVITY",
            entityId: activityId,
            data: { job: "muninn-draft-rca", reason: "empty_activity" },
          },
        });
        await prisma.agentEvent.create({
          data: {
            module: "system",
            category: "queue",
            action: "run_finished",
            runId,
            entity: "ACTIVITY",
            entityId: activityId,
            data: { job: "muninn-draft-rca", outcome: "skipped" },
          },
        });
        return { skip: "empty_activity" };
      }

      return {
        summary: row.aiSummary ?? "",
        body,
        sentiment: row.sentiment,
        companyId: row.companyId,
      };
    });
    if ("skip" in incident) return { ok: true, outcome: "skipped", reason: incident.skip };

    const fullText = `${incident.summary}\n\n${incident.body}`;

    // 2. HDS gate — same posture as Huginn: fail closed, flagged content never
    // reaches retrieval, drafting, or the ledger.
    const hds = await step.run("hds-gate", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const prompt = await getClassifierPrompt(prisma);
      const chunk = [{ seq: 0, text: fullText }];
      const verdicts = await classifyBatch(prisma, prompt, chunk);
      if (verdicts === null) {
        throw new Error(
          "Health classifier unavailable — fail closed, nothing drafted",
        );
      }
      const { flagged } = partitionByVerdict(chunk, verdicts);
      if (flagged.length === 0) return { flagged: false as const };
      const f = flagged[0];
      await prisma.agentEvent.create({
        data: {
          module: MUNINN_MODULE,
          category: MUNINN_CATEGORY,
          action: "quarantined",
          runId,
          entity: "ACTIVITY",
          entityId: activityId,
          data: {
            contentHash: sha256(fullText),
            categories: f.verdict.categories,
            confidence: f.verdict.confidence,
            promptKey: prompt.key,
            promptVersion: prompt.version,
          },
        },
      });
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_finished",
          runId,
          entity: "ACTIVITY",
          entityId: activityId,
          data: { job: "muninn-draft-rca", outcome: "quarantined" },
        },
      });
      return { flagged: true as const };
    });
    if (hds.flagged) return { ok: true, outcome: "quarantined" };

    // 3. Load the template + draft each section (retrieve scoped per section).
    const { sections, allSources, template } = await step.run(
      "retrieve-and-draft",
      async (): Promise<{
        sections: RcaSectionResult[];
        allSources: Passage[];
        template: { key: string; version: number; sections: RcaTemplateSection[] };
      }> => {
        const prisma = await tenantPrismaById(tenantId);
        const templateRow = await prisma.rcaTemplate.findFirst({
          where: { key: MUNINN_DEFAULT_TEMPLATE_KEY, active: true },
          orderBy: { version: "desc" },
        });
        if (!templateRow) {
          throw new Error(
            `No active RcaTemplate for key "${MUNINN_DEFAULT_TEMPLATE_KEY}" — is the tenant config seeded?`,
          );
        }
        const templateSections = templateRow.sections as unknown as RcaTemplateSection[];
        const indexReady = await isVectorIndexReady(prisma);

        const results: RcaSectionResult[] = [];
        const sourcesById = new Map<string, Passage>();
        for (const section of templateSections) {
          const passages = indexReady
            ? await retrieve(
                prisma,
                buildSectionRetrievalQuery(incident, section.label),
                { limit: 4 },
              )
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
        }

        return {
          sections: results,
          allSources: Array.from(sourcesById.values()),
          template: {
            key: templateRow.key,
            version: templateRow.version,
            sections: templateSections,
          },
        };
      },
    );

    // 4. Ledger proposal (PROPOSED; the `proposed` event comes from
    // proposeAction itself) — the actual document version is computed and
    // written at approval time (executeAction, src/lib/muninn/executor.ts),
    // not here, so concurrent regenerations never race on a version number.
    const actionId = await step.run("propose", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const config = await prisma.autonomyConfig.findUnique({
        where: { category: MUNINN_CATEGORY },
        select: { level: true },
      });
      const action = await proposeAction(prisma, {
        module: MUNINN_MODULE,
        category: MUNINN_CATEGORY,
        type: MUNINN_ACTION_TYPE,
        payload: {
          templateKey: template.key,
          templateVersion: template.version,
          sections,
        },
        sources: allSources,
        trigger: { kind: "manual", activityId },
        entity: "ACTIVITY",
        entityId: activityId,
        autonomyLevelAtProposal: config?.level ?? 0,
        reversible: true,
        expiresAt: new Date(Date.now() + RCA_DRAFT_EXPIRY_DAYS * 86_400_000),
      });
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_finished",
          runId,
          entity: "ACTIVITY",
          entityId: activityId,
          data: { job: "muninn-draft-rca", outcome: "drafted", actionId: action.id },
        },
      });
      return action.id;
    });

    return { ok: true, outcome: "drafted", actionId };
  },
);

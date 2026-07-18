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
  buildRetrievalQuery,
  classifySupportEmail,
  draftSupportReply,
  DRAFT_EXPIRY_DAYS,
  HUGINN_ACTION_TYPE,
  HUGINN_CATEGORY,
  HUGINN_CLASSIFY_PROMPT_KEY,
  HUGINN_DRAFT_PROMPT_KEY,
  HUGINN_MODULE,
  HUGINN_STATUS,
  type InboundEmailInput,
} from "@/lib/huginn/draft";

// S14b — Huginn draft pipeline. Scan finds inbound EMAIL Activities the
// pipeline hasn't touched (huginnStatus unset — the isSet:false trap) and
// fans out one draft job per email: HDS gate (S11 classifier, fail closed)
// -> support classify (Haiku) -> retrieve (S12) -> draft (Sonnet) ->
// proposeAction (PROPOSED only; approval surface + send are S15).
// Payloads carry IDs only (S4 standing rule).

export const huginnScanPayload = z.object({
  tenantId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
});

export const huginnDraftPayload = z.object({
  tenantId: z.string().min(1),
  activityId: z.string().min(1),
});

/** Default max emails enqueued per scan run (spend guard on backlogs). */
export const SCAN_BATCH_LIMIT = 25;

export const huginnScan = inngest.createFunction(
  {
    id: "huginn-inbox-scan",
    triggers: [{ event: "huginn/inbox.scan.requested" }],
    retries: 1,
  },
  async ({ event, step, runId }) => {
    const { tenantId, limit } = huginnScanPayload.parse(event.data);

    const ids = await step.run("find-unprocessed", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const rows = await prisma.activity.findMany({
        where: {
          type: "EMAIL",
          direction: "INBOUND",
          huginnStatus: { isSet: false },
        },
        orderBy: { date: "asc" },
        take: limit ?? SCAN_BATCH_LIMIT,
        select: { id: true },
      });
      if (rows.length === 0) return [];

      // Category gate: off/paused means leave the emails unmarked — they
      // process whenever the category turns on. Event only when work was
      // actually deferred, so an idle cron tick doesn't spam the stream.
      const config = await prisma.autonomyConfig.findUnique({
        where: { category: HUGINN_CATEGORY },
        select: { level: true, paused: true },
      });
      const reason =
        !config || config.level === 0
          ? "category_off"
          : config.paused
            ? "category_paused"
            : null;
      if (reason) {
        await prisma.agentEvent.create({
          data: {
            module: HUGINN_MODULE,
            category: HUGINN_CATEGORY,
            action: "skipped",
            runId,
            data: { job: "huginn-scan", reason, pending: rows.length },
          },
        });
        return [];
      }
      return rows.map((r) => r.id);
    });

    if (ids.length > 0) {
      await step.sendEvent(
        "enqueue-drafts",
        ids.map((activityId) => ({
          name: "huginn/email.draft.requested",
          data: { tenantId, activityId },
        })),
      );
    }

    return { ok: true, enqueued: ids.length };
  },
);

interface LoadedEmail extends InboundEmailInput {
  messageId: string | null;
  companyId: string | null;
}

async function markActivity(
  tenantId: string,
  activityId: string,
  status: string,
): Promise<void> {
  const prisma = await tenantPrismaById(tenantId);
  await prisma.activity.update({
    where: { id: activityId },
    data: { huginnStatus: status, huginnProcessedAt: new Date() },
  });
}

export const huginnDraftEmail = inngest.createFunction(
  {
    id: "huginn-draft-email",
    triggers: [{ event: "huginn/email.draft.requested" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const parsed = huginnDraftPayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { tenantId, activityId } = parsed.data;
      await markActivity(tenantId, activityId, HUGINN_STATUS.failed);
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          entity: "ACTIVITY",
          entityId: activityId,
          data: { job: "huginn-draft", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId }) => {
    const { tenantId, activityId } = huginnDraftPayload.parse(event.data);

    // 1. Load the email; guard against double-enqueue and non-email rows.
    const email = await step.run("load-email", async (): Promise<
      LoadedEmail | { skip: string }
    > => {
      const prisma = await tenantPrismaById(tenantId);
      const row = await prisma.activity.findUnique({
        where: { id: activityId },
        select: {
          type: true,
          direction: true,
          subject: true,
          body: true,
          note: true,
          fromEmail: true,
          messageId: true,
          companyId: true,
          huginnStatus: true,
        },
      });
      if (!row) throw new NonRetriableError(`Unknown activity: ${activityId}`);
      if (row.type !== "EMAIL" || row.direction !== "INBOUND") {
        throw new NonRetriableError(
          `Activity ${activityId} is not an inbound email`,
        );
      }
      if (row.huginnStatus) {
        throw new NonRetriableError(
          `Activity ${activityId} already processed: ${row.huginnStatus}`,
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
          data: { job: "huginn-draft" },
        },
      });
      const body = row.body ?? row.note ?? "";
      if (!row.fromEmail || body.trim().length === 0) {
        await prisma.activity.update({
          where: { id: activityId },
          data: {
            huginnStatus: HUGINN_STATUS.skippedNotSupport,
            huginnProcessedAt: new Date(),
          },
        });
        await prisma.agentEvent.create({
          data: {
            module: HUGINN_MODULE,
            category: HUGINN_CATEGORY,
            action: "skipped",
            runId,
            entity: "ACTIVITY",
            entityId: activityId,
            data: { job: "huginn-draft", reason: "empty_email" },
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
            data: { job: "huginn-draft", outcome: "skipped" },
          },
        });
        return { skip: "empty_email" };
      }
      return {
        fromEmail: row.fromEmail,
        subject: row.subject ?? "",
        body,
        messageId: row.messageId,
        companyId: row.companyId,
      };
    });
    if ("skip" in email) return { ok: true, outcome: "skipped", reason: email.skip };

    const text = `${email.subject}\n\n${email.body}`;

    // 2. HDS gate — the S11 health classifier on the whole email as one chunk
    // (the exact G2-evidence shape). Fail closed: classifier unavailable ->
    // throw -> retry -> FAILED with nothing drafted; flagged -> the email text
    // never reaches retrieval, drafting, or the ledger. Hash + verdict only.
    const hds = await step.run("hds-gate", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const prompt = await getClassifierPrompt(prisma);
      const chunk = [{ seq: 0, text }];
      const verdicts = await classifyBatch(prisma, prompt, chunk);
      if (verdicts === null) {
        throw new Error(
          "Health classifier unavailable — fail closed, nothing drafted",
        );
      }
      const { flagged } = partitionByVerdict(chunk, verdicts);
      if (flagged.length === 0) return { flagged: false as const };
      const f = flagged[0];
      await prisma.activity.update({
        where: { id: activityId },
        data: {
          huginnStatus: HUGINN_STATUS.quarantinedHealth,
          huginnProcessedAt: new Date(),
        },
      });
      await prisma.agentEvent.create({
        data: {
          module: HUGINN_MODULE,
          category: HUGINN_CATEGORY,
          action: "quarantined",
          runId,
          entity: "ACTIVITY",
          entityId: activityId,
          data: {
            contentHash: sha256(text),
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
          data: { job: "huginn-draft", outcome: "quarantined" },
        },
      });
      return { flagged: true as const };
    });
    if (hds.flagged) return { ok: true, outcome: "quarantined" };

    // 3. Support-shape classify (Haiku). Null = fail closed (retry -> FAILED).
    const verdict = await step.run("support-classify", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const prompt = await getActivePrompt(prisma, HUGINN_CLASSIFY_PROMPT_KEY);
      const v = await classifySupportEmail(prisma, prompt, email);
      if (v === null) {
        throw new Error("Support classifier unavailable — fail closed");
      }
      if (!v.support) {
        await prisma.activity.update({
          where: { id: activityId },
          data: {
            huginnStatus: HUGINN_STATUS.skippedNotSupport,
            huginnProcessedAt: new Date(),
          },
        });
        await prisma.agentEvent.create({
          data: {
            module: HUGINN_MODULE,
            category: HUGINN_CATEGORY,
            action: "skipped",
            runId,
            entity: "ACTIVITY",
            entityId: activityId,
            data: {
              job: "huginn-draft",
              reason: "not_support",
              classifierReason: v.reason,
              confidence: v.confidence,
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
            data: { job: "huginn-draft", outcome: "skipped" },
          },
        });
      }
      return v;
    });
    if (!verdict.support) return { ok: true, outcome: "skipped", reason: "not_support" };

    // 4. Retrieve grounding passages. An unready index throws (retryable —
    // never draft ungrounded because the index is still building); an empty
    // result on a ready index is legitimate (the prompt stays general).
    const passages = await step.run("retrieve", async (): Promise<Passage[]> => {
      const prisma = await tenantPrismaById(tenantId);
      if (!(await isVectorIndexReady(prisma))) {
        throw new Error("Vector index not ready — cannot ground the draft");
      }
      return retrieve(prisma, buildRetrievalQuery(email), { limit: 8 });
    });

    // 5. Draft (Sonnet). Null = fail closed.
    const drafted = await step.run("draft", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const prompt = await getActivePrompt(prisma, HUGINN_DRAFT_PROMPT_KEY);
      const draft = await draftSupportReply(
        prisma,
        prompt,
        email,
        verdict.category,
        passages,
      );
      if (draft === null) {
        throw new Error("Draft model unavailable — fail closed");
      }
      return { draft, promptKey: prompt.key, promptVersion: prompt.version };
    });

    // 6. Ledger proposal (PROPOSED; the `proposed` event comes from
    // proposeAction itself) + terminal marker.
    const actionId = await step.run("propose", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const config = await prisma.autonomyConfig.findUnique({
        where: { category: HUGINN_CATEGORY },
        select: { level: true },
      });
      const action = await proposeAction(prisma, {
        module: HUGINN_MODULE,
        category: HUGINN_CATEGORY,
        type: HUGINN_ACTION_TYPE,
        payload: {
          to: email.fromEmail,
          subject: drafted.draft.subject,
          body: drafted.draft.body,
          inReplyTo: email.messageId ?? undefined,
        },
        sources: passages,
        trigger: {
          kind: "email",
          activityId,
          messageId: email.messageId,
          fromEmail: email.fromEmail,
        },
        entity: email.companyId ? "COMPANY" : undefined,
        entityId: email.companyId ?? undefined,
        autonomyLevelAtProposal: config?.level ?? 0,
        promptKey: drafted.promptKey,
        promptVersion: drafted.promptVersion,
        reversible: false,
        expiresAt: new Date(Date.now() + DRAFT_EXPIRY_DAYS * 86_400_000),
      });
      await prisma.activity.update({
        where: { id: activityId },
        data: {
          huginnStatus: HUGINN_STATUS.drafted,
          huginnProcessedAt: new Date(),
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
          data: { job: "huginn-draft", outcome: "drafted", actionId: action.id },
        },
      });
      return action.id;
    });

    return { ok: true, outcome: "drafted", actionId };
  },
);

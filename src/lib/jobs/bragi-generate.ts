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
import { isSlotDue, periodKeyFor } from "@/lib/bragi/calendar";
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

// S18 — Bragi content pipeline. Scan sweeps the tenant's content calendar for
// due slots (dueness computed in code, src/lib/bragi/calendar.ts) and fans
// out one generation job per slot: HDS gate on the tenant-authored topic/brief
// (S11 classifier, fail closed — users paste client emails into briefs) ->
// retrieve (S12, empty passages legitimate) -> draft (Sonnet, styled by the
// BrandVoice pack) -> proposeAction (PROPOSED only). Payloads carry IDs only
// (S4 standing rule). Idempotence: lastGeneratedPeriod marker on the slot
// (layer 1, skipped by an explicit manual trigger) + PROPOSED-row guard in
// the ledger (layer 2, never skipped).

export const bragiScanPayload = z.object({
  tenantId: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export const bragiGeneratePayload = z.object({
  tenantId: z.string().min(1),
  slotId: z.string().min(1),
  // Set by the scan (deterministic even if the job runs after midnight);
  // absent on a manual trigger — the job computes it from the slot's cadence.
  periodKey: z.string().min(1).optional(),
});

/** Default max slots enqueued per scan run (spend guard). */
export const SCAN_BATCH_LIMIT = 10;

export const bragiScan = inngest.createFunction(
  {
    id: "bragi-calendar-scan",
    triggers: [{ event: "bragi/calendar.scan.requested" }],
    retries: 1,
  },
  async ({ event, step, runId }) => {
    const { tenantId, limit } = bragiScanPayload.parse(event.data);

    const due = await step.run("find-due-slots", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const now = new Date();
      const slots = await prisma.contentSlot.findMany({
        where: { active: true },
        select: {
          id: true,
          cadence: true,
          weekday: true,
          dayOfMonth: true,
          active: true,
          lastGeneratedPeriod: true,
        },
      });
      const dueSlots = slots.filter((s) => isSlotDue(s, now));
      if (dueSlots.length === 0) return [];

      // Category gate: off/paused means leave the slots unmarked — they
      // process whenever the category turns on. Event only when work was
      // actually deferred, so an idle cron tick doesn't spam the stream.
      const config = await prisma.autonomyConfig.findUnique({
        where: { category: BRAGI_CATEGORY },
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
            module: BRAGI_MODULE,
            category: BRAGI_CATEGORY,
            action: "skipped",
            runId,
            data: { job: "bragi-scan", reason, pending: dueSlots.length },
          },
        });
        return [];
      }
      return dueSlots
        .slice(0, limit ?? SCAN_BATCH_LIMIT)
        .map((s) => ({ slotId: s.id, periodKey: periodKeyFor(s.cadence, now) }));
    });

    if (due.length > 0) {
      await step.sendEvent(
        "enqueue-generation",
        due.map(({ slotId, periodKey }) => ({
          name: "bragi/content.generate.requested",
          data: { tenantId, slotId, periodKey },
        })),
      );
    }

    return { ok: true, enqueued: due.length };
  },
);

interface LoadedSlot extends ContentSlotInput {
  periodKey: string;
  manual: boolean;
  brandVoiceKey: string;
}

export const bragiGenerateContent = inngest.createFunction(
  {
    id: "bragi-generate-content",
    triggers: [{ event: "bragi/content.generate.requested" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const parsed = bragiGeneratePayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { tenantId, slotId } = parsed.data;
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          entity: "CONTENT_SLOT",
          entityId: slotId,
          data: { job: "bragi-generate", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId }) => {
    const { tenantId, slotId, periodKey: eventPeriodKey } =
      bragiGeneratePayload.parse(event.data);

    // 1. Load the slot + guard against a duplicate concurrent generation.
    const slot = await step.run("load-slot", async (): Promise<
      LoadedSlot | { skip: string }
    > => {
      const prisma = await tenantPrismaById(tenantId);
      const row = await prisma.contentSlot.findUnique({
        where: { id: slotId },
        select: {
          channel: true,
          topic: true,
          brief: true,
          cadence: true,
          brandVoiceKey: true,
          active: true,
          lastGeneratedPeriod: true,
        },
      });
      if (!row) throw new NonRetriableError(`Unknown content slot: ${slotId}`);
      if (!row.active) {
        throw new NonRetriableError(`Content slot ${slotId} is inactive`);
      }

      const pending = await prisma.agentAction.findFirst({
        where: {
          module: BRAGI_MODULE,
          category: BRAGI_CATEGORY,
          entity: "CONTENT_SLOT",
          entityId: slotId,
          status: "PROPOSED",
        },
        select: { id: true },
      });
      if (pending) {
        throw new NonRetriableError(
          `Slot ${slotId} already has a pending content proposal: ${pending.id}`,
        );
      }

      const manual = eventPeriodKey === undefined;
      const periodKey = eventPeriodKey ?? periodKeyFor(row.cadence, new Date());

      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_started",
          runId,
          entity: "CONTENT_SLOT",
          entityId: slotId,
          data: { job: "bragi-generate", periodKey },
        },
      });

      // Scan-triggered runs re-check the period marker (a manual trigger
      // deliberately bypasses it — that's how you force a regeneration).
      const alreadyDone = !manual && row.lastGeneratedPeriod === periodKey;
      if (alreadyDone || row.topic.trim().length === 0) {
        const reason = alreadyDone ? "period_already_generated" : "empty_topic";
        await prisma.agentEvent.create({
          data: {
            module: BRAGI_MODULE,
            category: BRAGI_CATEGORY,
            action: "skipped",
            runId,
            entity: "CONTENT_SLOT",
            entityId: slotId,
            data: { job: "bragi-generate", reason },
          },
        });
        await prisma.agentEvent.create({
          data: {
            module: "system",
            category: "queue",
            action: "run_finished",
            runId,
            entity: "CONTENT_SLOT",
            entityId: slotId,
            data: { job: "bragi-generate", outcome: "skipped" },
          },
        });
        return { skip: reason };
      }

      return {
        channel: row.channel,
        topic: row.topic,
        brief: row.brief,
        periodKey,
        manual,
        brandVoiceKey: row.brandVoiceKey,
      };
    });
    if ("skip" in slot) return { ok: true, outcome: "skipped", reason: slot.skip };

    const text = `${slot.topic}\n\n${slot.brief ?? ""}`.trim();

    // 2. HDS gate — the topic/brief is tenant-authored config, but users paste
    // client emails into briefs; uniform posture: no text reaches a drafting
    // model ungated. Fail closed; flagged -> hash + verdict only, and the
    // period is marked so the scan doesn't retry a flagged brief every tick
    // (a manual trigger after editing the brief re-attempts it).
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
      await prisma.contentSlot.update({
        where: { id: slotId },
        data: { lastGeneratedPeriod: slot.periodKey, lastGeneratedAt: new Date() },
      });
      await prisma.agentEvent.create({
        data: {
          module: BRAGI_MODULE,
          category: BRAGI_CATEGORY,
          action: "quarantined",
          runId,
          entity: "CONTENT_SLOT",
          entityId: slotId,
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
          entity: "CONTENT_SLOT",
          entityId: slotId,
          data: { job: "bragi-generate", outcome: "quarantined" },
        },
      });
      return { flagged: true as const };
    });
    if (hds.flagged) return { ok: true, outcome: "quarantined" };

    // 3. Brand voice + retrieval + draft. Passages ground factual claims but
    // their absence is legitimate for creative content (Muninn's posture:
    // unready index -> empty passages, the prompt stays general).
    const drafted = await step.run("retrieve-and-draft", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const voice = await prisma.brandVoice.findFirst({
        where: { key: slot.brandVoiceKey, active: true },
        orderBy: { version: "desc" },
      });
      if (!voice) {
        throw new Error(
          `No active BrandVoice for key "${slot.brandVoiceKey}" — is the tenant config seeded?`,
        );
      }

      const indexReady = await isVectorIndexReady(prisma);
      const passages: Passage[] = indexReady
        ? await retrieve(prisma, buildContentRetrievalQuery(slot), { limit: 4 })
        : [];

      const prompt = await getActivePrompt(prisma, promptKeyForChannel(slot.channel));
      const draft = await draftContentPiece(
        prisma,
        prompt,
        renderBrandVoiceBlock(voice),
        slot,
        passages,
      );
      if (draft === null) {
        throw new Error("Draft model unavailable — fail closed");
      }
      return {
        draft,
        passages,
        promptKey: prompt.key,
        promptVersion: prompt.version,
        brandVoiceVersion: voice.version,
      };
    });

    // 4. Ledger proposal (PROPOSED; the `proposed` event comes from
    // proposeAction itself) + period marker. The ContentPiece version is
    // computed at approval time (src/lib/bragi/executor.ts), not here, so
    // concurrent regenerations never race on a version number.
    const actionId = await step.run("propose", async () => {
      const prisma = await tenantPrismaById(tenantId);
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
          title: drafted.draft.title,
          body: drafted.draft.body,
          brandVoiceKey: slot.brandVoiceKey,
          brandVoiceVersion: drafted.brandVoiceVersion,
        },
        sources: drafted.passages,
        trigger: {
          kind: slot.manual ? "manual" : "calendar",
          slotId,
          periodKey: slot.periodKey,
        },
        entity: "CONTENT_SLOT",
        entityId: slotId,
        autonomyLevelAtProposal: config?.level ?? 0,
        promptKey: drafted.promptKey,
        promptVersion: drafted.promptVersion,
        reversible: true,
        expiresAt: new Date(Date.now() + CONTENT_DRAFT_EXPIRY_DAYS * 86_400_000),
      });
      await prisma.contentSlot.update({
        where: { id: slotId },
        data: { lastGeneratedPeriod: slot.periodKey, lastGeneratedAt: new Date() },
      });
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_finished",
          runId,
          entity: "CONTENT_SLOT",
          entityId: slotId,
          data: { job: "bragi-generate", outcome: "drafted", actionId: action.id },
        },
      });
      return action.id;
    });

    return { ok: true, outcome: "drafted", actionId };
  },
);

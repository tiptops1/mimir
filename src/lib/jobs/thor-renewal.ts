import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "./client";
import { tenantPrismaById } from "./tenant";
import { getActivePrompt } from "@/lib/prompts";
import { isVectorIndexReady } from "@/lib/rag/vector-index";
import { retrieve, type Passage } from "@/lib/rag/retrieve";
import { proposeAction } from "@/lib/heimdallr/ledger";
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

// S22b — Thor renewal pipeline. Scan re-evaluates every company's health live
// (src/lib/thor/health.ts, S22a) and fans out one draft job per at-risk/
// critical company: retrieve (S12, empty passages legitimate) -> draft
// (Sonnet, styled by the seeded thor.renewal.draft prompt) -> proposeAction
// (PROPOSED only). No HDS gate here — unlike Bragi's tenant-authored briefs,
// the draft input is deterministic CRM data the tenant already owns, not
// free text a user could paste client content into. Payloads carry IDs only
// (S4 standing rule). Idempotence: a pending-PROPOSED guard per company (the
// only layer needed — health is recomputed live every run, no period marker).
// Mirrors src/lib/jobs/bragi-generate.ts.

export const thorRenewalScanPayload = z.object({
  tenantId: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export const thorRenewalDraftPayload = z.object({
  tenantId: z.string().min(1),
  companyId: z.string().min(1),
});

/** Default max companies enqueued per scan run (spend guard). */
export const SCAN_BATCH_LIMIT = 10;

export const thorRenewalScan = inngest.createFunction(
  {
    id: "thor-renewal-scan",
    triggers: [{ event: "thor/renewal.scan.requested" }],
    retries: 1,
  },
  async ({ event, step, runId }) => {
    const { tenantId, limit } = thorRenewalScanPayload.parse(event.data);

    const due = await step.run("find-at-risk-companies", async () => {
      const prisma = await tenantPrismaById(tenantId);

      const config = await prisma.autonomyConfig.findUnique({
        where: { category: THOR_RENEWAL_CATEGORY },
        select: { level: true, paused: true },
      });
      const gateReason =
        !config || config.level === 0
          ? "category_off"
          : config.paused
            ? "category_paused"
            : null;

      const companies = await prisma.company.findMany({
        select: {
          id: true,
          nomSociete: true,
          enseigne: true,
          siret: true,
          dernierContact: true,
          deals: {
            select: { status: true, isPrimary: true, closeDate: true, updatedAt: true },
          },
          activities: {
            orderBy: { date: "desc" },
            take: 1,
            select: { sentiment: true, date: true },
          },
        },
      });

      const atRisk = companies.filter((c) => {
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
        const result = evaluateCompanyHealth(input);
        return result.band === "at_risk" || result.band === "critical";
      });

      if (atRisk.length === 0) return [];

      if (gateReason) {
        await prisma.agentEvent.create({
          data: {
            module: THOR_MODULE,
            category: THOR_RENEWAL_CATEGORY,
            action: "skipped",
            runId,
            data: { job: "thor-renewal-scan", reason: gateReason, pending: atRisk.length },
          },
        });
        return [];
      }

      const pendingActions = await prisma.agentAction.findMany({
        where: {
          module: THOR_MODULE,
          category: THOR_RENEWAL_CATEGORY,
          entity: "COMPANY",
          status: "PROPOSED",
        },
        select: { entityId: true },
      });
      const alreadyPending = new Set(pendingActions.map((a) => a.entityId));

      return atRisk
        .filter((c) => !alreadyPending.has(c.id))
        .slice(0, limit ?? SCAN_BATCH_LIMIT)
        .map((c) => c.id);
    });

    if (due.length > 0) {
      await step.sendEvent(
        "enqueue-drafts",
        due.map((companyId) => ({
          name: "thor/renewal.draft.requested",
          data: { tenantId, companyId },
        })),
      );
    }

    return { ok: true, enqueued: due.length };
  },
);

export const thorRenewalDraft = inngest.createFunction(
  {
    id: "thor-renewal-draft",
    triggers: [{ event: "thor/renewal.draft.requested" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const parsed = thorRenewalDraftPayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { tenantId, companyId } = parsed.data;
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          entity: "COMPANY",
          entityId: companyId,
          data: { job: "thor-renewal-draft", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId }) => {
    const { tenantId, companyId } = thorRenewalDraftPayload.parse(event.data);

    // 1. Load the company, recompute health live, guard against a duplicate
    // concurrent proposal.
    const loaded = await step.run("load-company-and-evaluate", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: {
          id: true,
          nomSociete: true,
          enseigne: true,
          siret: true,
          dernierContact: true,
          deals: {
            select: { status: true, isPrimary: true, closeDate: true, updatedAt: true },
          },
          activities: {
            orderBy: { date: "desc" },
            take: 1,
            select: { sentiment: true, date: true },
          },
        },
      });
      if (!company) throw new NonRetriableError(`Unknown company: ${companyId}`);

      const pending = await prisma.agentAction.findFirst({
        where: {
          module: THOR_MODULE,
          category: THOR_RENEWAL_CATEGORY,
          entity: "COMPANY",
          entityId: companyId,
          status: "PROPOSED",
        },
        select: { id: true },
      });
      if (pending) {
        throw new NonRetriableError(
          `Company ${companyId} already has a pending renewal proposal: ${pending.id}`,
        );
      }

      const latestActivity = company.activities[0] ?? null;
      const primaryOpenDeal = company.deals.find((d) => d.isPrimary && d.status === "OPEN") ?? null;
      const input: CompanyHealthInput = {
        id: company.id,
        name: company.nomSociete ?? company.enseigne ?? company.siret,
        dernierContact: company.dernierContact,
        latestActivitySentiment: latestActivity?.sentiment ?? null,
        latestActivityDate: latestActivity?.date ?? null,
        wonDeals: company.deals
          .filter((d) => d.status === "WON")
          .map((d) => ({ closeDate: d.closeDate })),
        primaryOpenDeal: primaryOpenDeal ? { updatedAt: primaryOpenDeal.updatedAt } : null,
      };
      const health = evaluateCompanyHealth(input);
      if (health.band === "healthy") {
        await prisma.agentEvent.create({
          data: {
            module: THOR_MODULE,
            category: THOR_RENEWAL_CATEGORY,
            action: "skipped",
            runId,
            entity: "COMPANY",
            entityId: companyId,
            data: { job: "thor-renewal-draft", reason: "no_longer_at_risk" },
          },
        });
        return { skip: "no_longer_at_risk" as const };
      }

      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_started",
          runId,
          entity: "COMPANY",
          entityId: companyId,
          data: { job: "thor-renewal-draft", band: health.band },
        },
      });

      return {
        companyId: company.id,
        companyName: input.name,
        score: health.score,
        band: health.band,
        signals: health.signals,
      };
    });
    if ("skip" in loaded) return { ok: true, outcome: "skipped", reason: loaded.skip };

    // 2. Retrieve grounding passages + draft (Sonnet).
    const drafted = await step.run("retrieve-and-draft", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const company = { companyId: loaded.companyId, companyName: loaded.companyName };
      const health = { score: loaded.score, band: loaded.band, signals: loaded.signals };

      const indexReady = await isVectorIndexReady(prisma);
      const passages: Passage[] = indexReady
        ? await retrieve(prisma, buildRenewalRetrievalQuery(company, health), { limit: 4 })
        : [];

      const prompt = await getActivePrompt(prisma, THOR_RENEWAL_PROMPT_KEY);
      const draft = await draftRenewalOutreach(prisma, prompt, company, health, passages);
      if (draft === null) {
        throw new Error("Draft model unavailable — fail closed");
      }
      return { draft, passages, promptKey: prompt.key, promptVersion: prompt.version };
    });

    // 3. Ledger proposal (PROPOSED; the `proposed` event comes from proposeAction itself).
    const actionId = await step.run("propose", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const config = await prisma.autonomyConfig.findUnique({
        where: { category: THOR_RENEWAL_CATEGORY },
        select: { level: true },
      });
      const action = await proposeAction(prisma, {
        module: THOR_MODULE,
        category: THOR_RENEWAL_CATEGORY,
        type: THOR_RENEWAL_ACTION_TYPE,
        payload: {
          companyId: loaded.companyId,
          companyName: loaded.companyName,
          band: loaded.band,
          score: loaded.score,
          signals: loaded.signals,
          subject: drafted.draft.subject,
          body: drafted.draft.body,
        },
        sources: drafted.passages,
        trigger: { kind: "health_sweep", companyId: loaded.companyId, band: loaded.band },
        entity: "COMPANY",
        entityId: loaded.companyId,
        autonomyLevelAtProposal: config?.level ?? 0,
        promptKey: drafted.promptKey,
        promptVersion: drafted.promptVersion,
        reversible: true,
        expiresAt: new Date(Date.now() + RENEWAL_DRAFT_EXPIRY_DAYS * 86_400_000),
      });
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_finished",
          runId,
          entity: "COMPANY",
          entityId: loaded.companyId,
          data: { job: "thor-renewal-draft", outcome: "drafted", actionId: action.id },
        },
      });
      return action.id;
    });

    return { ok: true, outcome: "drafted", actionId };
  },
);

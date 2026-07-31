import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "./client";
import { tenantPrismaById } from "./tenant";
import { getActivePrompt } from "@/lib/prompts";
import { proposeAction } from "@/lib/heimdallr/ledger";
import { getConnector, isApiConnector } from "@/lib/chronos/connectors";
import { parseMarketplaces } from "@/lib/chronos/config";
import { computeBand, fxRateFor, titleMatchesAliases } from "@/lib/chronos/comps";
import { listPointsForRef } from "@/lib/chronos/comps-store";
import {
  applyModelBid,
  scoreListing,
  KAIROS_ACTION_TYPE,
  KAIROS_CATEGORY,
  KAIROS_MODULE,
  KAIROS_PROMPT_KEY,
  OFFER_EXPIRY_DAYS,
} from "@/lib/chronos/kairos";
import { draftSourcingOffer, gateListingText } from "@/lib/chronos/kairos-draft";

// Kairos (S32) — the sourcing pipeline. Mirrors thor-renewal.ts: a scan that
// fans out one evaluate job per candidate, payloads carrying IDs only (S4).
//
// The order of operations inside `kairos-evaluate` is the design:
//
//   1. deterministic veto + comp arithmetic   (free, and un-gameable)
//   2. HDS/injection gate on the listing text (mandatory here — S32 precondition)
//   3. model call for a rationale + bid       (advisory)
//   4. clamp the model's bid to the ceiling   (arithmetic wins)
//   5. proposeAction — PROPOSED only, never executed
//
// A listing that fails step 1 never reaches a model at all, which is the point:
// the cheapest and least foolable check runs first.

export const kairosScanPayload = z.object({
  tenantId: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export const kairosEvaluatePayload = z.object({
  tenantId: z.string().min(1),
  candidateId: z.string().min(1),
});

/** Spend guard: model calls per scan run. */
export const KAIROS_BATCH_LIMIT = 8;

export const kairosScan = inngest.createFunction(
  { id: "kairos-scan", triggers: [{ event: "kairos/sourcing.scan.requested" }], retries: 1 },
  async ({ event, step, runId }) => {
    const { tenantId, limit } = kairosScanPayload.parse(event.data);

    const queued = await step.run("scan-watchlist", async () => {
      const prisma = await tenantPrismaById(tenantId);

      const config = await prisma.autonomyConfig.findUnique({
        where: { category: KAIROS_CATEGORY },
        select: { level: true, paused: true },
      });
      const gateReason =
        !config || config.level === 0
          ? "category_off"
          : config.paused
            ? "category_paused"
            : null;
      if (gateReason) {
        await prisma.agentEvent.create({
          data: {
            module: KAIROS_MODULE,
            category: KAIROS_CATEGORY,
            action: "skipped",
            runId,
            data: { job: "kairos-scan", reason: gateReason },
          },
        });
        return [];
      }

      const watches = await prisma.sourcingWatch.findMany({
        where: { active: true },
        include: { ref: { select: { id: true, brand: true, reference: true, aliases: true } } },
      });
      if (watches.length === 0) return [];

      const marketplaces = parseMarketplaces(
        (
          await prisma.chronosConfig.findUnique({
            where: { singleton: "default" },
            select: { marketplaces: true },
          })
        )?.marketplaces,
      );
      const provider =
        marketplaces.find(
          (m) =>
            m.sync === "api" &&
            isApiConnector(m.key) &&
            getConnector(m.key).capabilities.searchListings,
        )?.key ?? "";
      if (!provider) return [];

      const connector = getConnector(provider);
      if (!connector.searchListings) return [];

      const chronosConfig = await prisma.chronosConfig.findUnique({
        where: { singleton: "default" },
        select: { baseCurrency: true, fxRates: true, targetMarginPct: true, feeModel: true },
      });
      const baseCurrency = chronosConfig?.baseCurrency ?? "EUR";
      const fxRates = (chronosConfig?.fxRates as Record<string, number> | null) ?? null;
      const targetMarginPct = chronosConfig?.targetMarginPct ?? 25;
      const feeModel = (chronosConfig?.feeModel ?? {}) as Record<
        string,
        { finalValuePct?: number; fixedCents?: number; paymentPct?: number; regulatoryPct?: number }
      >;

      const ids: string[] = [];

      for (const watch of watches) {
        const ref = watch.ref;
        if (ref.aliases.length === 0) continue;

        let listings;
        try {
          listings = await connector.searchListings(
            { tenantId },
            `${ref.brand} ${ref.reference}`.trim(),
          );
        } catch {
          continue; // one reference failing must not abort the sweep
        }

        // The SOLD band, and only the SOLD band. See kairos.ts's header.
        const soldPoints = await listPointsForRef(prisma, ref.id, "SOLD");
        const soldBand = computeBand(soldPoints, { kind: "SOLD", now: new Date() });

        for (const listing of listings) {
          if (!titleMatchesAliases(listing.title, ref.aliases)) continue;

          // A human decision outranks a later scan, exactly as in S29's order
          // reconciliation: never reopen something already ruled on.
          const existing = await prisma.sourcingCandidate.findUnique({
            where: { provider_externalId: { provider, externalId: listing.externalId } },
            select: { id: true, status: true },
          });
          if (existing && existing.status !== "NEW") continue;

          const currency = listing.currency || baseCurrency;
          const askPriceCents = Math.round(
            listing.priceCents * fxRateFor(currency, baseCurrency, fxRates),
          );

          const scored = scoreListing({
            askPriceCents,
            title: listing.title,
            soldBand,
            targetMarginPct,
            resaleFees: feeModel[provider],
            refurbCostCents: watch.refurbCostCents,
            maxPricePct: watch.maxPricePct ?? undefined,
          });

          const data = {
            refId: ref.id,
            title: listing.title,
            url: listing.url ?? null,
            askPriceCents,
            currency,
            verdict: scored.verdict,
            score: scored.score,
            flags: scored.flags as never,
            maxBidCents: scored.ceiling?.maxBidCents ?? null,
            expectedResaleCents: scored.ceiling?.expectedResaleCents ?? null,
            headroomCents: scored.headroomCents,
            scannedAt: new Date(),
          };

          const row = await prisma.sourcingCandidate.upsert({
            where: { provider_externalId: { provider, externalId: listing.externalId } },
            update: data,
            create: { provider, externalId: listing.externalId, ...data },
          });

          // Only true candidates cost a model call. Vetoed / overpriced /
          // no-comp listings are STORED (so the operator can audit what was
          // passed over) but never drafted from.
          if (scored.verdict === "candidate") ids.push(row.id);
        }
      }

      return ids.slice(0, limit ?? KAIROS_BATCH_LIMIT);
    });

    if (queued.length > 0) {
      await step.sendEvent(
        "enqueue-evaluations",
        queued.map((candidateId) => ({
          name: "kairos/sourcing.evaluate.requested",
          data: { tenantId, candidateId },
        })),
      );
    }

    return { ok: true, enqueued: queued.length };
  },
);

export const kairosEvaluate = inngest.createFunction(
  {
    id: "kairos-evaluate",
    triggers: [{ event: "kairos/sourcing.evaluate.requested" }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const parsed = kairosEvaluatePayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const prisma = await tenantPrismaById(parsed.data.tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          entity: "SOURCING_CANDIDATE",
          entityId: parsed.data.candidateId,
          data: { job: "kairos-evaluate", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId }) => {
    const { tenantId, candidateId } = kairosEvaluatePayload.parse(event.data);

    // 1. Load, and re-check the deterministic verdict is still "candidate".
    const loaded = await step.run("load-candidate", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const candidate = await prisma.sourcingCandidate.findUnique({
        where: { id: candidateId },
        include: { ref: { select: { brand: true, reference: true, model: true } } },
      });
      if (!candidate) throw new NonRetriableError(`Unknown candidate: ${candidateId}`);
      if (candidate.verdict !== "candidate" || candidate.status !== "NEW") {
        return { skip: "not_a_live_candidate" as const };
      }

      const pending = await prisma.agentAction.findFirst({
        where: {
          module: KAIROS_MODULE,
          category: KAIROS_CATEGORY,
          entity: "SOURCING_CANDIDATE",
          entityId: candidateId,
          status: "PROPOSED",
        },
        select: { id: true },
      });
      if (pending) return { skip: "already_pending" as const };

      return {
        candidateId: candidate.id,
        refId: candidate.refId,
        refLabel: `${candidate.ref.brand} ${candidate.ref.reference}`.trim(),
        title: candidate.title,
        url: candidate.url,
        askPriceCents: candidate.askPriceCents,
        currency: candidate.currency,
        maxBidCents: candidate.maxBidCents ?? 0,
        expectedResaleCents: candidate.expectedResaleCents ?? 0,
        headroomCents: candidate.headroomCents ?? 0,
        score: candidate.score,
        flags: (candidate.flags ?? []) as Array<{ key: string; label: string; severity: string }>,
      };
    });
    if ("skip" in loaded) return { ok: true, outcome: "skipped", reason: loaded.skip };

    // 2. THE MANDATORY GATE — a listing is a stranger's prose about to be put in
    // front of a model that decides how much to offer. See kairos-draft.ts.
    const gated = await step.run("gate-listing-text", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const gate = await gateListingText(prisma, {
        externalId: loaded.candidateId,
        title: loaded.title,
        askPriceCents: loaded.askPriceCents,
        currency: loaded.currency,
      });
      if (!gate.ok) {
        // Hash + reason only. The flagged text is never persisted (S11 posture).
        await prisma.sourcingCandidate.update({
          where: { id: loaded.candidateId },
          data: { status: "QUARANTINED" },
        });
        await prisma.agentEvent.create({
          data: {
            module: KAIROS_MODULE,
            category: KAIROS_CATEGORY,
            action: "quarantined",
            runId,
            entity: "SOURCING_CANDIDATE",
            entityId: loaded.candidateId,
            data: { contentHash: gate.contentHash, reason: gate.reason },
          },
        });
      }
      return gate.ok;
    });
    if (!gated) return { ok: true, outcome: "quarantined" };

    // 3 + 4. Draft, then clamp. The arithmetic is the authority.
    const drafted = await step.run("draft-offer", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const prompt = await getActivePrompt(prisma, KAIROS_PROMPT_KEY);
      const out = await draftSourcingOffer(prisma, prompt, {
        refLabel: loaded.refLabel,
        listing: {
          externalId: loaded.candidateId,
          title: loaded.title,
          askPriceCents: loaded.askPriceCents,
          currency: loaded.currency,
          url: loaded.url,
        },
        scored: {
          verdict: "candidate",
          score: loaded.score,
          flags: loaded.flags as never,
          ceiling: {
            expectedResaleCents: loaded.expectedResaleCents,
            estimatedFeesCents: 0,
            refurbCostCents: 0,
            requiredMarginCents: 0,
            maxBidCents: loaded.maxBidCents,
          },
          headroomCents: loaded.headroomCents,
          reason: "",
        },
      });
      if (!out) throw new Error("Sourcing draft unavailable — fail closed");

      const { bidCents, clamped } = applyModelBid(out.recommendedBidCents, loaded.maxBidCents);
      if (clamped) {
        await prisma.agentEvent.create({
          data: {
            module: KAIROS_MODULE,
            category: KAIROS_CATEGORY,
            action: "guardrail_blocked",
            runId,
            entity: "SOURCING_CANDIDATE",
            entityId: loaded.candidateId,
            data: {
              reason: "model_bid_above_ceiling",
              modelBidCents: out.recommendedBidCents,
              ceilingCents: loaded.maxBidCents,
            },
          },
        });
      }
      return { bidCents, rationale: out.rationale, concerns: out.concerns, promptKey: prompt.key, promptVersion: prompt.version };
    });

    // 5. Propose. PROPOSED only — nothing here buys anything.
    const actionId = await step.run("propose", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const config = await prisma.autonomyConfig.findUnique({
        where: { category: KAIROS_CATEGORY },
        select: { level: true },
      });
      const action = await proposeAction(prisma, {
        module: KAIROS_MODULE,
        category: KAIROS_CATEGORY,
        type: KAIROS_ACTION_TYPE,
        payload: {
          candidateId: loaded.candidateId,
          refId: loaded.refId,
          refLabel: loaded.refLabel,
          listingTitle: loaded.title,
          listingUrl: loaded.url,
          askPriceCents: loaded.askPriceCents,
          maxBidCents: drafted.bidCents,
          expectedResaleCents: loaded.expectedResaleCents,
          rationale: drafted.rationale,
          flags: loaded.flags,
        },
        trigger: { kind: "sourcing_scan", candidateId: loaded.candidateId },
        entity: "SOURCING_CANDIDATE",
        entityId: loaded.candidateId,
        autonomyLevelAtProposal: config?.level ?? 0,
        promptKey: drafted.promptKey,
        promptVersion: drafted.promptVersion,
        reversible: true,
        // Short: listings end, and a stale ceiling is a wrong one.
        expiresAt: new Date(Date.now() + OFFER_EXPIRY_DAYS * 86_400_000),
      });
      await prisma.sourcingCandidate.update({
        where: { id: loaded.candidateId },
        data: { status: "PROPOSED" },
      });
      return action.id;
    });

    return { ok: true, outcome: "proposed", actionId };
  },
);

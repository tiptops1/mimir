import { z } from "zod";
import { estimateFees, type MarketplaceFeeModel } from "./margin";
import type { PriceBand } from "./comps";

// Kairos (S32) — sourcing decision math. PURE: no Prisma import, no I/O, same
// posture as margin.ts / comps.ts / thor/health.ts.
//
// This file decides how much money it is safe to offer for a watch, so it is
// written defensively on three counts:
//
// 1. **A bid ceiling is derived from SOLD comps ONLY.** Never from asks. An ask
//    is what a seller hopes for; a large share never sell. Pricing a purchase
//    off other people's hopes is how you buy a shelf full of unsellable stock.
//    `bidCeiling` takes a band already scoped to SOLD and returns null when
//    there is none — no band, no offer, full stop.
//
// 2. **Red flags are deterministic and run BEFORE any model call.** A listing
//    that says "for parts" or "not running" is disqualified by a regex, not by
//    an LLM's judgement, because that judgement is being applied to text a
//    stranger wrote and can therefore be gamed.
//
// 3. **The model can only lower a bid, never raise it.** `applyModelBid` clamps
//    to the computed ceiling. This mirrors Freyja's `maxBudgetDeltaPct`
//    guardrail: the arithmetic is the authority, the model is an adviser.
//
// Kairos NEVER buys. Nothing in this module, its executor or its job places a
// bid, and there is no code path in the repo that could — approval records a
// decision for a human to act on. `chronos.sourcing_offer` is seeded at
// `maxLevel: 1` (never graduates), the same floor as finance.commitment.

export const KAIROS_MODULE = "kairos";
export const KAIROS_CATEGORY = "chronos.sourcing_offer";
export const KAIROS_ACTION_TYPE = "sourcing.offer";
export const KAIROS_PROMPT_KEY = "chronos.sourcing.offer";
/** The injection/scam filter run over listing text before any drafting. */
export const KAIROS_GATE_PROMPT_KEY = "chronos.listing_gate";

/** A proposal ages out fast — listings end, and a stale bid ceiling is a wrong one. */
export const OFFER_EXPIRY_DAYS = 3;

/**
 * Disqualifying signals. A match here VETOES the listing outright rather than
 * discounting it: these describe a watch that is not the thing the reference
 * says it is, and no price makes that a good buy at scale.
 *
 * Patterns are matched case-insensitively against title + description, in both
 * French and English — his stock comes from IE/UK/EU listings.
 */
export const VETO_FLAGS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "for_parts", label: "Vendu pour pièces", pattern: /\b(for parts|spares? or repairs?|pour pi[eè]ces|d[ée]tach[ée]es)\b/i },
  { key: "not_running", label: "Ne fonctionne pas", pattern: /\b(not (running|working)|doesn'?t (run|work)|ne fonctionne pas|en panne|hs)\b/i },
  { key: "replica", label: "Réplique / contrefaçon", pattern: /\b(replica|homage|fake|copie|contrefa[çc]on)\b/i },
  { key: "franken", label: "Assemblage (franken)", pattern: /\b(franken(watch)?|assembl[ée]e? [àa] partir|parts? watch)\b/i },
  { key: "redial", label: "Cadran repeint", pattern: /\b(re-?dial(led)?|repainted dial|cadran repeint|refinished dial)\b/i },
];

/**
 * Signals that don't disqualify but must be visible and priced in. These lower
 * the confidence shown to the operator; they never silently move the ceiling,
 * because a discount the operator can't see is a discount they can't check.
 */
export const CAUTION_FLAGS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "aftermarket", label: "Pièces non d'origine", pattern: /\b(aftermarket|non[- ]?original|generic (dial|hands|bezel))\b/i },
  { key: "no_return", label: "Sans retour possible", pattern: /\b(no returns?|sans retour|vente ferme|as[- ]is)\b/i },
  { key: "untested", label: "Non testé", pattern: /\b(untested|not tested|non test[ée])\b/i },
  { key: "service_needed", label: "Révision nécessaire", pattern: /\b(needs? (a )?service|[àa] r[ée]viser|r[ée]vision n[ée]cessaire)\b/i },
  { key: "no_papers", label: "Sans boîte ni papiers", pattern: /\b(no (box|papers)|sans (bo[iî]te|papiers)|watch only)\b/i },
];

export interface DetectedFlag {
  key: string;
  label: string;
  severity: "veto" | "caution";
}

/**
 * Scan listing text for known signals.
 *
 * The text is treated strictly as DATA. It is a stranger's prose arriving over
 * the network, and downstream it is also passed to a model — which is why the
 * S32 precondition makes the HDS classifier gate mandatory here, re-justified
 * as prompt-injection defence rather than health-data exclusion.
 */
export function detectFlags(title: string, description = ""): DetectedFlag[] {
  const haystack = `${title}\n${description}`;
  const found: DetectedFlag[] = [];
  for (const f of VETO_FLAGS) {
    if (f.pattern.test(haystack)) found.push({ key: f.key, label: f.label, severity: "veto" });
  }
  for (const f of CAUTION_FLAGS) {
    if (f.pattern.test(haystack)) found.push({ key: f.key, label: f.label, severity: "caution" });
  }
  return found;
}

export function hasVeto(flags: DetectedFlag[]): boolean {
  return flags.some((f) => f.severity === "veto");
}

export interface BidCeilingInput {
  /** MUST be the SOLD band. Passing an ASK band is a caller bug — see below. */
  band: PriceBand;
  /** ChronosConfig.targetMarginPct — the tenant's own commercial floor. */
  targetMarginPct: number;
  /** Fee model of the marketplace he would RESELL on. */
  resaleFees?: MarketplaceFeeModel;
  /** Expected restoration spend for this reference, from the watchlist row. */
  refurbCostCents?: number;
}

export interface BidCeiling {
  /** The realistic resale price: the median of his own completed sales. */
  expectedResaleCents: number;
  estimatedFeesCents: number;
  refurbCostCents: number;
  requiredMarginCents: number;
  /** The most he can pay and still clear the target margin. Never negative. */
  maxBidCents: number;
}

/**
 * The most that can be paid for one unit and still clear the target margin.
 *
 *   maxBid = resale − resaleFees − refurb − requiredMargin
 *
 * Returns null when the band is not a SOLD band, which is a hard guard rather
 * than a courtesy: pricing a purchase off asking prices is the single most
 * expensive mistake this module could make, and `computeBand` already refuses
 * to mix the two kinds upstream.
 */
export function bidCeiling(input: BidCeilingInput): BidCeiling | null {
  if (input.band.kind !== "SOLD") return null;

  const expectedResaleCents = input.band.medianCents;
  if (expectedResaleCents <= 0) return null;

  const estimatedFeesCents = estimateFees(expectedResaleCents, input.resaleFees);
  const refurbCostCents = Math.max(0, Math.round(input.refurbCostCents ?? 0));
  const requiredMarginCents = Math.round(
    (expectedResaleCents * Math.max(0, input.targetMarginPct)) / 100,
  );

  const maxBidCents = Math.max(
    0,
    expectedResaleCents - estimatedFeesCents - refurbCostCents - requiredMarginCents,
  );

  return {
    expectedResaleCents,
    estimatedFeesCents,
    refurbCostCents,
    requiredMarginCents,
    maxBidCents,
  };
}

export type SourcingVerdict = "candidate" | "too_expensive" | "vetoed" | "no_comp";

export interface ScoredListing {
  verdict: SourcingVerdict;
  /** 0–100. Headroom between the ask and the ceiling. 0 when not a candidate. */
  score: number;
  flags: DetectedFlag[];
  ceiling: BidCeiling | null;
  /** ceiling.maxBidCents − askPriceCents. Negative means it is overpriced. */
  headroomCents: number;
  reason: string;
}

/**
 * Score one listing against a reference's SOLD band.
 *
 * Order matters and is deliberate: veto BEFORE comp lookup, comp BEFORE price.
 * A "for parts" listing should read as *vetoed*, not as "no comparable" — the
 * operator needs the real reason, and the cheaper checks also cost nothing.
 */
export function scoreListing(args: {
  askPriceCents: number;
  title: string;
  description?: string;
  soldBand: PriceBand | null;
  targetMarginPct: number;
  resaleFees?: MarketplaceFeeModel;
  refurbCostCents?: number;
  /** Watchlist cap: never bid above this share of the sold median. */
  maxPricePct?: number;
}): ScoredListing {
  const flags = detectFlags(args.title, args.description ?? "");

  if (hasVeto(flags)) {
    const vetoes = flags.filter((f) => f.severity === "veto").map((f) => f.label);
    return {
      verdict: "vetoed",
      score: 0,
      flags,
      ceiling: null,
      headroomCents: 0,
      reason: `Écartée : ${vetoes.join(", ")}.`,
    };
  }

  if (!args.soldBand) {
    return {
      verdict: "no_comp",
      score: 0,
      flags,
      ceiling: null,
      headroomCents: 0,
      reason: "Aucune vente comparable — pas de base de prix fiable.",
    };
  }

  const ceiling = bidCeiling({
    band: args.soldBand,
    targetMarginPct: args.targetMarginPct,
    resaleFees: args.resaleFees,
    refurbCostCents: args.refurbCostCents,
  });
  if (!ceiling) {
    return {
      verdict: "no_comp",
      score: 0,
      flags,
      ceiling: null,
      headroomCents: 0,
      reason: "Bande de prix inexploitable.",
    };
  }

  // The watchlist cap is applied on top of, never instead of, the margin
  // arithmetic — whichever is stricter wins.
  const cappedMaxBid =
    args.maxPricePct !== undefined
      ? Math.min(
          ceiling.maxBidCents,
          Math.round((args.soldBand.medianCents * Math.max(0, args.maxPricePct)) / 100),
        )
      : ceiling.maxBidCents;

  const effective: BidCeiling = { ...ceiling, maxBidCents: cappedMaxBid };
  const headroomCents = cappedMaxBid - args.askPriceCents;

  if (headroomCents < 0) {
    return {
      verdict: "too_expensive",
      score: 0,
      flags,
      ceiling: effective,
      headroomCents,
      reason: "Prix demandé au-dessus du plafond d'achat.",
    };
  }

  // Headroom as a share of the ceiling, so a €50 margin on a €200 watch scores
  // like a €500 margin on a €2 000 one.
  const score = cappedMaxBid > 0 ? Math.round((headroomCents / cappedMaxBid) * 100) : 0;

  return {
    verdict: "candidate",
    score: Math.max(0, Math.min(100, score)),
    flags,
    ceiling: effective,
    headroomCents,
    reason: "Sous le plafond d'achat calculé sur vos ventes réalisées.",
  };
}

// ————— model output —————

export const kairosOutputSchema = z.object({
  /** The model's recommended bid. Clamped to the computed ceiling downstream. */
  recommendedBidCents: z.number().int().min(0),
  rationale: z.string().min(1),
  /** Anything the regexes missed. Advisory only — never used to raise a bid. */
  concerns: z.array(z.string()).default([]),
});

export type KairosOutput = z.infer<typeof kairosOutputSchema>;

/** Fail closed: unparseable output yields null and the caller proposes nothing. */
export function parseKairosOutput(text: string | null): KairosOutput | null {
  if (!text) return null;
  const stripped = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  try {
    const parsed = kairosOutputSchema.safeParse(JSON.parse(stripped));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Reconcile the model's recommendation with the arithmetic.
 *
 * The model may only ever bid LOWER. A model that returns a higher number — by
 * mistake, or because the listing text talked it into one — is clamped, and the
 * clamp is reported so the operator sees it happened. This is the same posture
 * as Freyja's budget-delta guardrail: computed limits are the authority.
 */
export function applyModelBid(
  modelBidCents: number,
  ceilingCents: number,
): { bidCents: number; clamped: boolean } {
  const safe = Math.max(0, Math.round(modelBidCents));
  return safe > ceilingCents
    ? { bidCents: ceilingCents, clamped: true }
    : { bidCents: safe, clamped: false };
}

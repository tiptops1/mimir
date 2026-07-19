// Thor (S22a) — pure account-health-scoring logic. No Prisma import here
// (same posture as evaluateCompanyCompliance) so this stays unit-testable
// without a tenant connection. Deterministic churn signals only — S22b adds
// the LLM renewal agent on top. Not the S11 HDS health classifier (that's
// medical-content quarantine); this is customer-account health.

export const STALE_CONTACT_DAYS = 45; // no dernierContact / activity within this window
export const RENEWAL_WINDOW_DAYS_MIN = 305; // ~10 months since a WON deal's closeDate
export const RENEWAL_WINDOW_DAYS_MAX = 395; // ~13 months — renewal-approaching band
export const STALLED_DEAL_DAYS = 60; // open primary deal untouched this long

export type HealthBand = "healthy" | "at_risk" | "critical";

export interface HealthSignal {
  key: string; // "stale_contact" | "negative_sentiment" | "renewal_approaching" | "stalled_deal"
  label: string;
  detail: string;
}

export interface CompanyHealthResult {
  companyId: string;
  companyName: string;
  score: number; // 0-100, 100 = no signals
  band: HealthBand;
  signals: HealthSignal[];
}

export interface CompanyHealthInput {
  id: string;
  name: string;
  dernierContact: Date | null;
  latestActivitySentiment: string | null; // most recent Activity.sentiment, or null
  latestActivityDate: Date | null;
  wonDeals: Array<{ closeDate: Date | null }>; // WON deals, any product
  primaryOpenDeal: { updatedAt: Date } | null; // the isPrimary OPEN deal, if any
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

const SIGNAL_WEIGHTS: Record<HealthSignal["key"], number> = {
  stale_contact: 25,
  negative_sentiment: 30,
  renewal_approaching: 20,
  stalled_deal: 25,
};

function bandForScore(score: number): HealthBand {
  if (score < 50) return "critical";
  if (score < 80) return "at_risk";
  return "healthy";
}

/**
 * Evaluate one company's account health from CRM signals already on record —
 * no new fields, no AI call. Pure — same `now` in, same result out.
 */
export function evaluateCompanyHealth(
  input: CompanyHealthInput,
  now: Date = new Date(),
): CompanyHealthResult {
  const signals: HealthSignal[] = [];

  const lastTouch = [input.dernierContact, input.latestActivityDate]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  if (!lastTouch || daysBetween(now, lastTouch) > STALE_CONTACT_DAYS) {
    signals.push({
      key: "stale_contact",
      label: "Aucun contact récent",
      detail: lastTouch
        ? `Dernier contact il y a ${Math.round(daysBetween(now, lastTouch))} jours`
        : "Aucun contact enregistré",
    });
  }

  if (input.latestActivitySentiment === "NEGATIF") {
    signals.push({
      key: "negative_sentiment",
      label: "Dernier échange négatif",
      detail: "Le dernier échange enregistré a un sentiment négatif",
    });
  }

  const renewalDeal = input.wonDeals.find((d) => {
    if (!d.closeDate) return false;
    const age = daysBetween(now, d.closeDate);
    return age >= RENEWAL_WINDOW_DAYS_MIN && age <= RENEWAL_WINDOW_DAYS_MAX;
  });
  if (renewalDeal?.closeDate) {
    signals.push({
      key: "renewal_approaching",
      label: "Renouvellement proche",
      detail: `Contrat signé il y a ${Math.round(daysBetween(now, renewalDeal.closeDate))} jours`,
    });
  }

  if (
    input.primaryOpenDeal &&
    daysBetween(now, input.primaryOpenDeal.updatedAt) > STALLED_DEAL_DAYS
  ) {
    signals.push({
      key: "stalled_deal",
      label: "Opportunité au point mort",
      detail: `Aucune mise à jour depuis ${Math.round(daysBetween(now, input.primaryOpenDeal.updatedAt))} jours`,
    });
  }

  const score = Math.max(
    0,
    100 - signals.reduce((sum, s) => sum + SIGNAL_WEIGHTS[s.key], 0),
  );

  return {
    companyId: input.id,
    companyName: input.name,
    score,
    band: bandForScore(score),
    signals,
  };
}

export interface HealthSummary {
  companyCount: number;
  healthyCount: number;
  atRiskCount: number;
  criticalCount: number;
}

/** Aggregate per-company results into the snapshot/dashboard tile counts. */
export function summarizeHealth(results: CompanyHealthResult[]): HealthSummary {
  return {
    companyCount: results.length,
    healthyCount: results.filter((r) => r.band === "healthy").length,
    atRiskCount: results.filter((r) => r.band === "at_risk").length,
    criticalCount: results.filter((r) => r.band === "critical").length,
  };
}

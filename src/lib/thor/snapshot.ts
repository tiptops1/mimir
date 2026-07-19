import type { PrismaClient } from "@prisma/client";
import {
  evaluateCompanyHealth,
  summarizeHealth,
  type CompanyHealthInput,
  type CompanyHealthResult,
} from "./health";

// Thor (S22a) — the scheduled sweep: score every company's account health and
// persist one HealthSnapshot row (history for the dashboard trend). Detection
// only — no ledger proposal, no LLM. Same shape as Forseti's
// runComplianceSnapshotForTenant (src/lib/forseti/snapshot.ts), simpler here
// because there's nothing to propose yet (S22b adds the renewal agent).

export const THOR_MODULE = "thor";

export interface ThorSweepResult {
  snapshotId: string;
  companyCount: number;
  healthyCount: number;
  atRiskCount: number;
  criticalCount: number;
}

/** One tenant's health sweep. Called from the cron route per ACTIVE tenant. */
export async function runHealthSnapshotForTenant(
  prisma: PrismaClient,
): Promise<ThorSweepResult> {
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

  const inputs: CompanyHealthInput[] = companies.map((c) => {
    const latestActivity = c.activities[0] ?? null;
    const primaryOpenDeal = c.deals.find((d) => d.isPrimary && d.status === "OPEN") ?? null;
    return {
      id: c.id,
      name: c.nomSociete ?? c.enseigne ?? c.siret,
      dernierContact: c.dernierContact,
      latestActivitySentiment: latestActivity?.sentiment ?? null,
      latestActivityDate: latestActivity?.date ?? null,
      wonDeals: c.deals
        .filter((d) => d.status === "WON")
        .map((d) => ({ closeDate: d.closeDate })),
      primaryOpenDeal: primaryOpenDeal ? { updatedAt: primaryOpenDeal.updatedAt } : null,
    };
  });

  const results: CompanyHealthResult[] = inputs.map((input) => evaluateCompanyHealth(input));
  const summary = summarizeHealth(results);

  const snapshot = await prisma.healthSnapshot.create({
    data: { ...summary, details: results as never },
  });

  return { snapshotId: snapshot.id, ...summary };
}

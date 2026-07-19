import type { PrismaClient } from "@prisma/client";
import {
  evaluateCompanyCompliance,
  summarizeCompliance,
  type CompanyComplianceResult,
} from "./compliance";
import { proposeAction } from "@/lib/heimdallr/ledger";

// Forseti (S19) — the scheduled sweep: evaluate every company's compliance,
// persist one ComplianceSnapshot row (history for the dashboard trend), and
// propose a follow-up Task via the ledger for every open issue that doesn't
// already have one. Synchronous (no LLM call, no Inngest) — same shape as the
// outreach cron (src/lib/tenant-cron.ts settle/listActiveTenants), simpler
// than the Bragi/Muninn/Huginn draft pipelines because there's nothing to
// generate, only to detect.

export const FORSETI_MODULE = "forseti";
// Reuses the existing crm.task_create category (seeded, unused until now) —
// D5: no module invents its own approval flow.
export const FORSETI_CATEGORY = "crm.task_create";
export const FORSETI_TASK_ACTION_TYPE = "forseti.compliance_task";

const OPEN_STATUSES = ["PROPOSED", "APPROVED", "EXECUTED"] as const;

interface CompliancePayload {
  issueKey: string;
  companyId: string;
  title: string;
  dueDate: string | null;
  note: string;
}

/** True if this company+issue already has an open (not rejected/expired/undone) proposal. */
function hasOpenProposal(
  existing: Array<{ payload: unknown }>,
  issueKey: string,
): boolean {
  return existing.some((a) => (a.payload as CompliancePayload | null)?.issueKey === issueKey);
}

export interface ForsetiSweepResult {
  snapshotId: string;
  companyCount: number;
  compliantCount: number;
  expiringCount: number;
  expiredCount: number;
  missingCount: number;
  proposed: number;
}

/** One tenant's compliance sweep. Called from the cron route per ACTIVE tenant. */
export async function runComplianceSnapshotForTenant(
  prisma: PrismaClient,
): Promise<ForsetiSweepResult> {
  const companies = await prisma.company.findMany({
    select: { id: true, nomSociete: true, enseigne: true, siret: true, customFields: true },
  });

  const results: CompanyComplianceResult[] = companies.map((c) =>
    evaluateCompanyCompliance(
      { id: c.id, name: c.nomSociete ?? c.enseigne ?? c.siret, customFields: c.customFields },
    ),
  );
  const summary = summarizeCompliance(results);

  const snapshot = await prisma.complianceSnapshot.create({
    data: { ...summary, details: results as never },
  });

  const config = await prisma.autonomyConfig.findUnique({
    where: { category: FORSETI_CATEGORY },
    select: { level: true },
  });

  let proposed = 0;
  for (const result of results) {
    if (result.issues.length === 0) continue;
    const existing = await prisma.agentAction.findMany({
      where: {
        module: FORSETI_MODULE,
        type: FORSETI_TASK_ACTION_TYPE,
        entity: "COMPANY",
        entityId: result.companyId,
        status: { in: [...OPEN_STATUSES] },
      },
      select: { payload: true },
    });

    for (const issue of result.issues) {
      if (hasOpenProposal(existing, issue.key)) continue;
      const payload: CompliancePayload = {
        issueKey: issue.key,
        companyId: result.companyId,
        title: `Conformité ${issue.label} — ${result.companyName}`,
        dueDate: issue.dueDate,
        note:
          issue.severity === "missing"
            ? `${issue.label} manquant pour ${result.companyName}.`
            : issue.severity === "expired"
              ? `${issue.label} expiré pour ${result.companyName}${issue.dueDate ? ` (échéance ${issue.dueDate})` : ""}.`
              : `${issue.label} arrive à échéance pour ${result.companyName}${issue.dueDate ? ` (${issue.dueDate})` : ""}.`,
      };
      await proposeAction(prisma, {
        module: FORSETI_MODULE,
        category: FORSETI_CATEGORY,
        type: FORSETI_TASK_ACTION_TYPE,
        payload,
        entity: "COMPANY",
        entityId: result.companyId,
        autonomyLevelAtProposal: config?.level ?? 0,
        trigger: { kind: "cron" },
        reversible: true,
      });
      proposed += 1;
    }
  }

  return { snapshotId: snapshot.id, ...summary, proposed };
}

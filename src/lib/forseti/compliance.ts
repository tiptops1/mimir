// Forseti (S19) — pure compliance-evaluation logic. No Prisma import here
// (same posture as computeNextRcaVersion/computeNextContentVersion) so this
// stays unit-testable without a tenant connection. Vertical-specific: French
// insurance-broker compliance (ORIAS registration, RC Pro liability
// insurance, KYC). Fields are config-driven (Company.customFields, seeded by
// src/lib/default-config.ts) — no schema dependency beyond that Json blob.
//
// readCustomFields is duplicated from src/lib/field-config.ts (not imported)
// because that module pulls in tenant-context.ts, which is "server-only" —
// this file needs to stay importable from scripts/seed-demo-data.ts.
function readCustomFields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const EXPIRING_WINDOW_DAYS = 30;

export type ComplianceSeverity = "expired" | "expiring" | "missing";
export type ComplianceStatus = "compliant" | ComplianceSeverity;

export interface ComplianceIssue {
  key: string; // "orias" | "rc_pro" | "kyc" — stable, used for ledger dedupe
  label: string;
  severity: ComplianceSeverity;
  dueDate: string | null; // ISO date, when the issue is expiry-based
}

export interface CompanyComplianceInput {
  id: string;
  name: string;
  customFields: unknown;
}

export interface CompanyComplianceResult {
  companyId: string;
  companyName: string;
  status: ComplianceStatus;
  issues: ComplianceIssue[];
}

function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Expired/expiring/compliant/null(no date set) for one expiry-dated requirement. */
function evaluateExpiry(
  dateValue: unknown,
  now: Date,
): ComplianceSeverity | null {
  const date = parseDate(dateValue);
  if (!date) return "missing";
  if (date.getTime() < now.getTime()) return "expired";
  const windowMs = EXPIRING_WINDOW_DAYS * 86_400_000;
  if (date.getTime() - now.getTime() <= windowMs) return "expiring";
  return null;
}

/** The worst severity wins for the company-level status; no issues = compliant. */
function worstSeverity(issues: ComplianceIssue[]): ComplianceStatus {
  if (issues.some((i) => i.severity === "expired")) return "expired";
  if (issues.some((i) => i.severity === "missing")) return "missing";
  if (issues.some((i) => i.severity === "expiring")) return "expiring";
  return "compliant";
}

/**
 * Evaluate one company's ORIAS / RC Pro / KYC compliance from its
 * customFields. Pure — same `now` in, same result out.
 */
export function evaluateCompanyCompliance(
  company: CompanyComplianceInput,
  now: Date = new Date(),
): CompanyComplianceResult {
  const fields = readCustomFields(company.customFields);
  const issues: ComplianceIssue[] = [];

  const oriasSeverity = evaluateExpiry(fields.oriasDateExpiration, now);
  if (oriasSeverity) {
    issues.push({
      key: "orias",
      label: "ORIAS",
      severity: oriasSeverity,
      dueDate: typeof fields.oriasDateExpiration === "string" ? fields.oriasDateExpiration : null,
    });
  }

  const rcProSeverity = evaluateExpiry(fields.rcProDateExpiration, now);
  if (rcProSeverity) {
    issues.push({
      key: "rc_pro",
      label: "RC Pro",
      severity: rcProSeverity,
      dueDate: typeof fields.rcProDateExpiration === "string" ? fields.rcProDateExpiration : null,
    });
  }

  const kycStatut = typeof fields.kycStatut === "string" ? fields.kycStatut : null;
  if (kycStatut === "MANQUANT" || kycStatut === null) {
    issues.push({ key: "kyc", label: "KYC", severity: "missing", dueDate: null });
  } else if (kycStatut === "A_RELANCER") {
    issues.push({ key: "kyc", label: "KYC", severity: "expiring", dueDate: null });
  }

  return {
    companyId: company.id,
    companyName: company.name,
    status: worstSeverity(issues),
    issues,
  };
}

export interface ComplianceSummary {
  companyCount: number;
  compliantCount: number;
  expiringCount: number;
  expiredCount: number;
  missingCount: number;
}

/** Aggregate per-company results into the snapshot/dashboard tile counts. */
export function summarizeCompliance(
  results: CompanyComplianceResult[],
): ComplianceSummary {
  return {
    companyCount: results.length,
    compliantCount: results.filter((r) => r.status === "compliant").length,
    expiringCount: results.filter((r) => r.status === "expiring").length,
    expiredCount: results.filter((r) => r.status === "expired").length,
    missingCount: results.filter((r) => r.status === "missing").length,
  };
}

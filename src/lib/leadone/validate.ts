import { resolveMx } from "node:dns/promises";
import type { LeadCandidate } from "@prisma/client";

// Lead One validation: free, in-process checks only. Email syntax + a DNS MX
// lookup (no paid verification API), then a 0–100 confidence score. A lead is
// review-ready (VALIDATED) as soon as any contact signal is present: website,
// phone, or email — even if only one is found.

const EMAIL_SYNTAX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export type EmailStatus = "MX_VALID" | "SYNTAX_ONLY" | "INVALID";

export async function validateEmail(email: string): Promise<EmailStatus> {
  if (!EMAIL_SYNTAX.test(email)) return "INVALID";
  try {
    const mx = await resolveMx(email.split("@")[1]);
    return mx.length > 0 ? "MX_VALID" : "SYNTAX_ONLY";
  } catch {
    // NXDOMAIN → dead domain; transient DNS errors also land here, which is
    // fine: SYNTAX_ONLY is a soft signal, not a rejection.
    return "SYNTAX_ONLY";
  }
}

type Scorable = Pick<
  LeadCandidate,
  "siteWeb" | "telephone" | "email" | "emailStatus" | "emailKind" | "specialites"
>;

/** Confidence 0–100: website 25, phone 20, email 20, MX +15, nominative +10, speciality +10. */
export function scoreCandidate(c: Scorable): number {
  let score = 0;
  if (c.siteWeb) score += 25;
  if (c.telephone) score += 20;
  if (c.email) score += 20;
  if (c.email && c.emailStatus === "MX_VALID") score += 15;
  if (c.email && c.emailKind === "NOMINATIVE") score += 10;
  const spec = (c.specialites ?? {}) as Record<string, boolean>;
  if (Object.values(spec).some(Boolean)) score += 10;
  return score;
}

export function isValidated(c: Scorable): boolean {
  return Boolean(c.siteWeb || c.telephone || c.email);
}

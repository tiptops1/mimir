import { Inngest } from "inngest";

// Job-queue client (S4 decision: Inngest — see docs/mimir/decisions.md).
// Standing rule: event payloads carry IDs only (tenantId + entity ids), never
// domain content. Every step reads/writes domain state through the DB router,
// so the queue provider never stores tenant data.
export const inngest = new Inngest({ id: "mimir" });

/**
 * The "merged behind config" gate (aiEnabled() idiom): jobs are inert unless
 * the environment provides Inngest credentials (production) or explicitly
 * opts into the local dev server (INNGEST_DEV=1, no keys needed).
 */
export function jobsEnabled(): boolean {
  return Boolean(process.env.INNGEST_SIGNING_KEY) || process.env.INNGEST_DEV === "1";
}

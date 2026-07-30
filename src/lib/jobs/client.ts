import { Inngest } from "inngest";
import { mimirEnv } from "@/lib/env-identity";

// Job-queue client (S4 decision: Inngest — see docs/mimir/decisions.md).
// Standing rule: event payloads carry IDs only (tenantId + entity ids), never
// domain content. Every step reads/writes domain state through the DB router,
// so the queue provider never stores tenant data.
//
// S28: the app id carries the environment. It was the bare literal "mimir",
// which would give a staging deploy and a production deploy one shared app
// identity and one shared event stream — a dev-triggered scan could be served
// by a prod function, or vice versa. Registering two apps keeps them apart.
export const inngest = new Inngest({ id: `mimir-${mimirEnv()}` });

/**
 * The "merged behind config" gate (aiEnabled() idiom): jobs are inert unless
 * the environment provides Inngest credentials (production) or explicitly
 * opts into the local dev server (INNGEST_DEV=1, no keys needed).
 */
export function jobsEnabled(): boolean {
  return Boolean(process.env.INNGEST_SIGNING_KEY) || process.env.INNGEST_DEV === "1";
}

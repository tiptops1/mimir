import { Inngest } from "inngest";
import { appEnv } from "@/lib/env-identity";

// Job-queue client (S4 decision: Inngest — see docs/chronos/decisions.md).
// Standing rule: event payloads carry IDs only (tenantId + entity ids), never
// domain content. Every step reads/writes domain state through the DB router,
// so the queue provider never stores tenant data.
//
// The app id carries the environment: a bare literal would give a staging
// deploy and a production deploy one shared app identity and one shared event
// stream — a dev-triggered scan could be served by a prod function, or vice
// versa. Registering two apps keeps them apart.
//
// The "mimir-" prefix is a REGISTERED IDENTITY on the Inngest side, not a brand
// string: the deployed apps, their event history and their in-flight runs are
// keyed on it. Renaming it here would orphan every queued job at deploy time,
// so the rebrand deliberately stops at this line. Change it only alongside a
// drained queue and a new app registration.
export const inngest = new Inngest({ id: `mimir-${appEnv()}` });

/**
 * The "merged behind config" gate (aiEnabled() idiom): jobs are inert unless
 * the environment provides Inngest credentials (production) or explicitly
 * opts into the local dev server (INNGEST_DEV=1, no keys needed).
 */
export function jobsEnabled(): boolean {
  return Boolean(process.env.INNGEST_SIGNING_KEY) || process.env.INNGEST_DEV === "1";
}

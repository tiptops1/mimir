import {
  dbHostSummary,
  distinctDbHosts,
  mimirEnv,
} from "../../src/lib/env-identity";

/**
 * Environment guard for scripts.
 *
 * Every script in this repo is `import "dotenv/config"` with no environment
 * selector, so each one silently inherits whatever `.env` happens to say. That
 * was survivable while `mimir-dev` was the only cluster. With a paying
 * customer's production environment in existence it is the single largest
 * hazard in the repo, so scripts that touch data now declare their intent.
 *
 * Two helpers, drawing one line:
 *
 *   assertProdAllowed()  — legitimate prod operations (provision a tenant, push
 *                          a schema, set branding, add a user, run a backfill).
 *                          Permitted in prod, but only when the operator says
 *                          `--prod` out loud.
 *
 *   refuseInProd()       — demo seeders and scratch/debug scripts. There is no
 *                          override. A script that fabricates demo data has no
 *                          legitimate use against a production cluster, so the
 *                          right affordance is "no", not "are you sure".
 *
 * Both also reject a half-edited `.env` (DB vars pointing at different hosts) —
 * the state in which a script writes into one environment's control plane and
 * another environment's tenant data.
 */

function fail(lines: string[]): never {
  console.error(`\n${lines.join("\n")}\n`);
  process.exit(1);
}

/** Hosts must agree, whichever environment this is. Never prints credentials. */
function assertHostsAgree(): void {
  const hosts = distinctDbHosts();
  if (hosts.length > 1) {
    fail([
      "GUARD: refusing to run — the configured DB URLs point at different clusters.",
      dbHostSummary(),
      "",
      "A half-edited .env writes into one environment's control plane and another's",
      "tenant data. Fix .env, then re-run `npm run env:check`.",
    ]);
  }
}

export interface GuardOptions {
  /** What this script does, for the confirmation banner. Defaults to argv[1]. */
  label?: string;
}

function scriptLabel(label?: string): string {
  return label ?? process.argv[1]?.split(/[\\/]/).pop() ?? "this script";
}

/**
 * Allow the operation in dev; in prod require an explicit `--prod` flag.
 *
 * Call this FIRST in any script that writes to a database.
 */
export function assertProdAllowed(opts: GuardOptions = {}): void {
  assertHostsAgree();
  const env = mimirEnv();
  const label = scriptLabel(opts.label);

  if (env !== "prod") return;

  if (!process.argv.includes("--prod")) {
    fail([
      `GUARD: MIMIR_ENV=prod — refusing to run ${label} without an explicit --prod flag.`,
      dbHostSummary(),
      "",
      "This is a PRODUCTION environment with a real customer's data. If that is",
      "genuinely what you meant, re-run the same command with --prod appended.",
    ]);
  }

  console.warn(
    [
      "",
      `⚠  PRODUCTION — ${label} is running against prod (--prod given).`,
      dbHostSummary(),
      "",
    ].join("\n"),
  );
}

/**
 * Never allow the operation in prod. For demo seeders and scratch scripts.
 *
 * No flag unlocks this. If a prod tenant ever genuinely needs seeded data, that
 * is a provisioning script, not a demo script.
 */
export function refuseInProd(opts: GuardOptions = {}): void {
  assertHostsAgree();
  if (mimirEnv() !== "prod") return;

  fail([
    `GUARD: MIMIR_ENV=prod — ${scriptLabel(opts.label)} is a demo/scratch script and will not run against production.`,
    dbHostSummary(),
    "",
    "There is no override flag. Point your .env at a development environment.",
  ]);
}

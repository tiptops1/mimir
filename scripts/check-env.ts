import "dotenv/config";
import {
  DB_URL_VARS,
  dbHosts,
  distinctDbHosts,
  mimirEnv,
} from "../src/lib/env-identity";

/**
 * Pre-flight for a deploy or a data-touching command:
 *
 *   npm run env:check
 *
 * Answers "is this environment configured, and is it the one I think it is?"
 * without ever printing a secret. There is no env-validation module in the app
 * itself (every consumer either throws or silently falls back), so this is the
 * one place that looks at the whole surface at once. Step 1 of the deploy
 * runbook — see docs/mimir/ops.md.
 *
 * Exits 1 on any FAIL so it can gate a script or a CI step.
 */

type Status = "ok" | "warn" | "fail";

interface Check {
  status: Status;
  label: string;
  detail?: string;
}

const checks: Check[] = [];

function add(status: Status, label: string, detail?: string) {
  checks.push({ status, label, detail });
}

/** Present-or-not only. The VALUE never leaves this process. */
function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/** Required everywhere: without these the app cannot serve a single request. */
const CORE = [
  "CONTROL_DATABASE_URL",
  "CLUSTER_BASE_URL",
  "ENCRYPTION_KEY",
  "SESSION_SECRET",
] as const;

/** Required in prod only; a dev box legitimately runs without them. */
const PROD_ONLY = ["APP_URL", "CRON_SECRET"] as const;

/**
 * Feature keys. Absent means that feature is off, which is a legitimate state —
 * reported so a missing key is a conscious choice rather than a surprise.
 */
const OPTIONAL = [
  "DATABASE_URL",
  "PLATFORM_ADMIN_EMAILS",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "INNGEST_SIGNING_KEY",
  "INNGEST_EVENT_KEY",
  "INNGEST_DEV",
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "EBAY_RUNAME",
  "EBAY_ENV",
  "NEXT_PUBLIC_BRAND_NAME",
  "NEXT_PUBLIC_BRAND_TAGLINE",
] as const;

function main() {
  let env: ReturnType<typeof mimirEnv>;
  try {
    env = mimirEnv();
  } catch (e) {
    console.error(`FAIL  ${(e as Error).message}`);
    process.exit(1);
  }

  const declared = process.env.MIMIR_ENV?.trim();
  console.log(`\nEnvironment: ${env.toUpperCase()}${declared ? "" : "  (MIMIR_ENV unset — defaulting to dev)"}`);
  console.log("\nDatabase hosts");
  for (const { name, host } of dbHosts()) {
    console.log(`  ${name.padEnd(22)} ${host ?? "(unset)"}`);
  }
  console.log("");

  // MIMIR_ENV must be explicit in prod — "I forgot to set it" and "this is dev"
  // are the same state otherwise, and the guard would wave prod work through.
  if (env === "prod" && !declared) {
    add("fail", "MIMIR_ENV", "must be set explicitly to 'prod' in a production environment");
  } else {
    add("ok", "MIMIR_ENV", declared ?? "dev (default)");
  }

  for (const name of CORE) {
    if (present(name)) add("ok", name);
    else add("fail", name, "required in every environment");
  }

  for (const name of PROD_ONLY) {
    if (present(name)) add("ok", name);
    else if (env === "prod") add("fail", name, "required when MIMIR_ENV=prod");
    else add("warn", name, "unset (fine in dev; required in prod)");
  }

  // Shape check, not a value check: crypto.ts throws on a non-32-byte key at
  // first use, which in prod means "at first login" rather than "at deploy".
  const rawKey = process.env.ENCRYPTION_KEY?.trim();
  if (rawKey) {
    const bytes = Buffer.from(rawKey, "base64").length;
    if (bytes === 32) add("ok", "ENCRYPTION_KEY shape", "32 bytes base64");
    else add("fail", "ENCRYPTION_KEY shape", `decodes to ${bytes} bytes, expected 32`);
  }

  // Control plane and tenant data share a cluster in both environments today, so
  // disagreeing hosts mean a half-edited .env — the exact state in which a
  // script writes into one environment's control plane and another's data.
  const hosts = distinctDbHosts();
  if (hosts.length > 1) {
    add(
      "fail",
      "DB host agreement",
      `${DB_URL_VARS.join(" / ")} resolve to ${hosts.length} different hosts: ${hosts.join(", ")}`,
    );
  } else if (hosts.length === 1) {
    add("ok", "DB host agreement", hosts[0]);
  }

  const optionalMissing = OPTIONAL.filter((n) => !present(n));

  for (const c of checks) {
    const tag = c.status === "ok" ? "ok  " : c.status === "warn" ? "WARN" : "FAIL";
    console.log(`${tag}  ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
  }

  if (optionalMissing.length) {
    console.log(`\nOptional, unset (feature off): ${optionalMissing.join(", ")}`);
  }

  const failures = checks.filter((c) => c.status === "fail");
  console.log(
    failures.length
      ? `\n${failures.length} check(s) failed.\n`
      : `\nAll required variables present for ${env}.\n`,
  );
  process.exit(failures.length ? 1 : 0);
}

main();

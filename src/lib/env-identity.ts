/**
 * Which environment is this process talking to?
 *
 * There was once exactly one legitimate cluster and the rule was "never point
 * this repo at a prod cluster". A paying customer now has a production
 * environment of his own, so the question changes shape: not "does a prod
 * cluster exist" but "does this process's env match the environment the command
 * intends".
 *
 * Intent is DECLARED via CHRONOS_ENV, never sniffed from a hostname. Sniffing
 * fails exactly when it matters — a copy-pasted prod URI in a dev `.env` would
 * "correctly" identify itself as prod and sail through, when the whole point is
 * to catch that the shell is not what the operator thinks it is.
 *
 * MIMIR_ENV is still read as a fallback. That name is set in the deployed
 * Vercel projects and in existing `.env` files; dropping it during the rebrand
 * would silently reclassify a prod shell as dev, which is precisely the failure
 * this module exists to prevent. CHRONOS_ENV wins when both are set.
 *
 * No `server-only` guard: `scripts/lib/guard.ts` imports this from tsx, same as
 * `src/lib/crypto.ts`.
 */

export type AppEnv = "dev" | "prod";

/** @deprecated Legacy alias of AppEnv, kept so existing imports keep compiling. */
export type MimirEnv = AppEnv;

export class EnvIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvIdentityError";
  }
}

/** Declared environment. Absent means dev — prod must always be explicit. */
export function appEnv(): AppEnv {
  const legacy = process.env.MIMIR_ENV;
  const declared = process.env.CHRONOS_ENV ?? legacy;
  const varName = process.env.CHRONOS_ENV != null ? "CHRONOS_ENV" : "MIMIR_ENV";
  const raw = (declared ?? "dev").trim().toLowerCase();
  if (raw === "prod" || raw === "production") return "prod";
  if (raw === "dev" || raw === "development" || raw === "") return "dev";
  throw new EnvIdentityError(
    `${varName} is "${raw}" — expected "dev" or "prod". Refusing to guess which cluster this is.`,
  );
}

/** @deprecated Renamed to appEnv. Kept so any stale import keeps compiling. */
export const mimirEnv = appEnv;

export function isProd(): boolean {
  return appEnv() === "prod";
}

/** The DB vars whose hosts must agree with each other. */
export const DB_URL_VARS = [
  "CONTROL_DATABASE_URL",
  "CLUSTER_BASE_URL",
  "DATABASE_URL",
] as const;

export type DbUrlVar = (typeof DB_URL_VARS)[number];

export interface DbHost {
  name: DbUrlVar;
  /** Hostname only — never the credentials that precede it. */
  host: string | null;
}

/**
 * Hostnames of the configured DB URLs, for display and for the agreement check.
 *
 * Deliberately returns hostnames and nothing else: every consumer of this prints
 * to a terminal or a log, and a Mongo URI carries a username and password in
 * front of the host.
 */
export function dbHosts(): DbHost[] {
  return DB_URL_VARS.map((name) => ({ name, host: hostOf(process.env[name]) }));
}

export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  // mongodb+srv:// parses fine in WHATWG URL; fall back to a regex for the
  // odd unparseable string rather than throwing inside a safety check.
  try {
    return new URL(url).host || null;
  } catch {
    return /@([^/?]+)/.exec(url)?.[1] ?? null;
  }
}

/** One-line summary safe to print: "CONTROL_DATABASE_URL -> abc.mongodb.net". */
export function dbHostSummary(): string {
  return dbHosts()
    .map(({ name, host }) => `  ${name} -> ${host ?? "(unset)"}`)
    .join("\n");
}

/**
 * Do the configured DB URLs point at the same cluster?
 *
 * Control plane and tenant data live on the same cluster in both environments
 * today, so disagreement means a half-edited `.env` — the state in which a
 * script writes demo data into one environment's control plane and another's
 * tenant DB. Returns the distinct hosts found (0 or 1 = consistent).
 */
export function distinctDbHosts(): string[] {
  const hosts = dbHosts()
    .map((h) => h.host)
    .filter((h): h is string => h !== null);
  return [...new Set(hosts)];
}

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient as ControlClient } from "../src/generated/control";
import { decrypt } from "../src/lib/crypto";
import { assertProdAllowed } from "./lib/guard";
import { hostOf, appEnv } from "../src/lib/env-identity";

assertProdAllowed({ label: "backup:dump" });

/**
 * Logical backup of tenant data via `mongodump`.
 *
 *   npm run backup:dump -- --slug chronos_demo
 *   npm run backup:dump -- --all --prod
 *
 * WHY THIS EXISTS, in plain terms: the production cluster runs on Atlas M0,
 * which has **no backups of any kind** — no snapshots, no point-in-time
 * recovery, nothing to restore from. That was a deliberate, cost-driven choice
 * (see docs/chronos/ops.md), and this script plus a scheduled run of it IS the
 * recovery story. If it is not being run, there is no backup.
 *
 * Writes to ./backups/<env>-<timestamp>/<db>/ (git-ignored). Requires
 * `mongodump` from the MongoDB Database Tools on PATH.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function haveMongodump(): boolean {
  const probe = spawnSync("mongodump", ["--version"], { stdio: "ignore", shell: true });
  return probe.status === 0;
}

/** Runs mongodump. The URI is passed as an argv entry and never logged. */
function dump(uri: string, outDir: string, label: string): boolean {
  console.log(`  ${label} (${hostOf(uri) ?? "?"}) …`);
  const r = spawnSync("mongodump", [`--uri=${uri}`, `--out=${outDir}`], {
    stdio: ["ignore", "ignore", "inherit"],
    shell: true,
  });
  if (r.status !== 0) {
    console.error(`  ✗ ${label} failed (mongodump exit ${r.status})`);
    return false;
  }
  console.log(`  ✓ ${label}`);
  return true;
}

async function main() {
  if (!haveMongodump()) {
    console.error(
      [
        "",
        "`mongodump` was not found on PATH.",
        "",
        "Install the MongoDB Database Tools:",
        "  https://www.mongodb.com/docs/database-tools/installation/",
        "On Windows: winget install MongoDB.DatabaseTools",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  const slug = arg("slug");
  const all = process.argv.includes("--all");
  if (!slug && !all) {
    console.error("Usage: npm run backup:dump -- (--slug <slug> | --all) [--out <dir>]");
    process.exit(1);
  }

  const controlUrl = process.env.CONTROL_DATABASE_URL;
  if (!controlUrl) {
    console.error("CONTROL_DATABASE_URL is not set.");
    process.exit(1);
  }

  const root = arg("out") ?? join(process.cwd(), "backups");
  const outDir = join(root, `${appEnv()}-${stamp()}`);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(`\nBackup -> ${outDir}\n`);

  const control = new ControlClient({ datasourceUrl: controlUrl });
  let failures = 0;
  try {
    const tenants = await control.tenant.findMany({
      where: slug ? { slug } : { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { slug: true, connectionString: true },
    });

    if (tenants.length === 0) {
      console.error(slug ? `Unknown tenant: ${slug}` : "No ACTIVE tenants found.");
      process.exit(1);
    }

    // The control plane holds every tenant's (encrypted) connection string and
    // all logins. Restoring tenant data without it is a pile of orphan
    // databases, so it goes in the same archive.
    if (!dump(controlUrl, outDir, "control plane")) failures++;

    for (const t of tenants) {
      if (!dump(decrypt(t.connectionString), outDir, `tenant ${t.slug}`)) failures++;
    }
  } finally {
    await control.$disconnect();
  }

  if (failures) {
    console.error(`\n${failures} dump(s) failed — this backup is INCOMPLETE.\n`);
    process.exit(1);
  }
  console.log(
    [
      "",
      "✓ Backup complete.",
      "",
      "A dump you have never restored is not a backup. Verify with:",
      `  mongorestore --uri="<a scratch cluster URI>" --drop "${outDir}"`,
      "",
    ].join("\n"),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

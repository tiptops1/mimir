import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * Push the tenant schema against ONE named tenant DB.
 *
 *   npm run db:push:tenant -- --slug chronos_demo
 *
 * `npm run db:push` only ever targets the single DATABASE_URL in .env, which is
 * fine while one demo tenant exists and wrong as soon as two do. Provisioning
 * already solves this inline (scripts/provision-tenant.ts step 1) but only for
 * brand-new tenants; this is the same mechanic for an EXISTING one, so an
 * additive schema change can be rolled out per tenant.
 *
 * Run the mimir-env-guard skill first — this writes indexes to a live DB.
 * Requires CLUSTER_BASE_URL (a base connection string whose DB-name path is
 * swapped for the tenant slug), exactly as provision-tenant.ts derives it.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("Usage: db:push:tenant -- --slug <slug>");

  const url = new URL(required("CLUSTER_BASE_URL"));
  url.pathname = `/${slug}`;

  console.log(`Pushing tenant schema to "${slug}" (${url.host})…`);
  execSync("npx prisma db push --schema=prisma/tenant/schema.prisma --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
  console.log(`✓ Schema pushed to "${slug}"`);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}

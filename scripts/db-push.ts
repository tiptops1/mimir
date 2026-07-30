import "dotenv/config";
import { execSync } from "node:child_process";
import { assertProdAllowed } from "./lib/guard";
import { hostOf, isProd } from "../src/lib/env-identity";

/**
 * Guarded wrapper around `prisma db push`, behind two npm scripts:
 *
 *   npm run db:push            -> the TENANT schema against DATABASE_URL
 *   npm run db:push:control    -> the CONTROL schema against CONTROL_DATABASE_URL
 *
 * Both used to be raw `prisma db push` invocations, which take whatever the
 * ambient `.env` says with no confirmation of any kind.
 *
 * The tenant variant is additionally REFUSED in production: it only ever targets
 * the single `DATABASE_URL`, which was fine with one demo tenant and is wrong
 * with several — in production it would push a schema to whichever tenant DB
 * happens to be in `.env` and quietly skip the rest. `db:push:tenant --slug X`
 * is the correct tool there, per-tenant and explicit.
 */

const control = process.argv.includes("--control");

if (control) {
  assertProdAllowed({ label: "db:push:control" });
} else if (isProd()) {
  console.error(
    [
      "",
      "GUARD: MIMIR_ENV=prod — `npm run db:push` is refused in production.",
      "",
      "It only ever targets the single DATABASE_URL, so in an environment with",
      "more than one tenant it pushes to one DB and silently leaves the others",
      "behind. Roll the schema out per tenant instead:",
      "",
      "  npm run db:push:tenant -- --slug <slug> --prod",
      "",
    ].join("\n"),
  );
  process.exit(1);
} else {
  assertProdAllowed({ label: "db:push" });
}

const schema = control ? "prisma/control/schema.prisma" : "prisma/tenant/schema.prisma";
const target = control ? "CONTROL_DATABASE_URL" : "DATABASE_URL";
const url = process.env[target];
if (!url) {
  console.error(`${target} is not set.`);
  process.exit(1);
}

console.log(`Pushing ${control ? "control" : "tenant"} schema -> ${hostOf(url) ?? "(unknown host)"}…`);
execSync(`npx prisma db push --schema=${schema}`, { stdio: "inherit" });

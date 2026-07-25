import "dotenv/config";
import { PrismaClient as ControlClient } from "../src/generated/control";

/**
 * One-time backfill after adding Tenant.modules (S26, Chronos vertical): rows
 * created before the field existed have no `modules` key in Mongo, and Prisma's
 * `@default` only applies on write — a read of a legacy row would fail on the
 * missing required scalar. Stamp every legacy tenant as CRM-only, which is what
 * they all are today.
 *
 *   npx tsx scripts/backfill-tenant-modules.ts
 *
 * Idempotent: the filter only matches rows where the field is absent.
 * Same shape as scripts/backfill-integration-purpose.ts.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function main() {
  const control = new ControlClient({
    datasourceUrl: required("CONTROL_DATABASE_URL"),
  });
  try {
    const res = (await control.$runCommandRaw({
      update: "Tenant",
      updates: [
        {
          q: { modules: { $exists: false } },
          u: { $set: { modules: ["crm"] } },
          multi: true,
        },
      ],
    })) as unknown as { n?: number; nModified?: number };
    console.log(
      `Tenant modules backfill: matched ${res.n ?? 0}, modified ${res.nModified ?? 0}.`,
    );
  } finally {
    await control.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

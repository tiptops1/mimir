import "dotenv/config";
import { PrismaClient as ControlClient } from "../src/generated/control";

/**
 * One-time backfill after adding Integration.purpose (outreach WP1): rows
 * created before the field existed have no `purpose` key in Mongo, so the new
 * compound unique lookups ({ tenantId, provider, purpose: "MAIN" }) would miss
 * them. Stamp every legacy row as MAIN.
 *
 *   npx tsx scripts/backfill-integration-purpose.ts
 *
 * Idempotent: the filter only matches rows where the field is absent.
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
      update: "Integration",
      updates: [
        {
          q: { purpose: { $exists: false } },
          u: { $set: { purpose: "MAIN" } },
          multi: true,
        },
      ],
    })) as unknown as { n?: number; nModified?: number };
    console.log(
      `Integration purpose backfill: matched ${res.n ?? 0}, modified ${res.nModified ?? 0}.`,
    );
  } finally {
    await control.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

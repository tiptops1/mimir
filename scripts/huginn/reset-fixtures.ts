import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient, type Prisma } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";

// S14b — re-drive helper: UNSET huginnStatus/huginnProcessedAt on fixture
// Activities (messageId "fixture:*") so the next scan picks them up again
// after a prompt tweak. Must $unset (not write null): the scan queries
// { huginnStatus: { isSet: false } }, and a Prisma null write would leave the
// field present with value null — never matched again.
//
//   npx tsx scripts/huginn/reset-fixtures.ts [--slug crm_demo] [--all]
//
// --all resets every inbound EMAIL Activity, not just fixtures (e.g. to
// re-drive a real inbox after a budget reset). ASCII output only.

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = argValue("--slug") ?? "crm_demo";
  const all = process.argv.includes("--all");

  const control = new ControlClient();
  try {
    const tenant = await control.tenant.findUnique({
      where: { slug },
      select: { connectionString: true },
    });
    if (!tenant) throw new Error(`Unknown tenant: ${slug}`);

    const prisma = new TenantClient({
      datasourceUrl: decrypt(tenant.connectionString),
    });
    try {
      const q: Record<string, Prisma.InputJsonValue> = {
        type: "EMAIL",
        direction: "INBOUND",
        huginnStatus: { $exists: true },
      };
      if (!all) q.messageId = { $regex: "^fixture:" };
      const res = (await prisma.$runCommandRaw({
        update: "Activity",
        updates: [
          {
            q,
            u: { $unset: { huginnStatus: "", huginnProcessedAt: "" } },
            multi: true,
          },
        ],
      })) as { nModified?: number };
      console.log(`Reset ${res.nModified ?? 0} activities (${all ? "all inbound" : "fixtures only"}).`);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

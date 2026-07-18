import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";
import { SAMPLE_INBOX } from "./sample-inbox";

// S14b — inject SAMPLE_INBOX fixtures as inbound EMAIL Activities so the
// Huginn draft pipeline can be exercised without a live Gmail inbox.
// Idempotent: messageId "fixture:<id>" is the dedup key.
//
//   npx tsx scripts/huginn/inject-fixtures.ts [--limit N] [--only cat1,cat2] [--slug crm_demo]
//
// ASCII output only (cp1252 console) — never echoes the French bodies.

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const limit = Number(argValue("--limit") ?? SAMPLE_INBOX.length);
  const only = argValue("--only")?.split(",").map((s) => s.trim());
  const slug = argValue("--slug") ?? "crm_demo";

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
      const pool = SAMPLE_INBOX.filter(
        (e) => !only || only.includes(e.category),
      ).slice(0, limit);

      let created = 0;
      let skipped = 0;
      for (const e of pool) {
        const messageId = `fixture:${e.id}`;
        const existing = await prisma.activity.findFirst({
          where: { messageId },
          select: { id: true },
        });
        if (existing) {
          skipped++;
          continue;
        }
        await prisma.activity.create({
          data: {
            type: "EMAIL",
            direction: "INBOUND",
            subject: e.subject,
            note: e.body.slice(0, 180),
            body: e.body,
            fromEmail: e.from,
            toEmail: "support@cabinet.example",
            messageId,
            date: new Date(),
          },
        });
        created++;
        console.log(`+ ${e.id} (${e.category}${e.containsHealthData ? ", health" : ""})`);
      }
      console.log(`Done. created=${created} skipped=${skipped} of ${pool.length}`);
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

import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";
import { HUGINN_CATEGORY } from "../../src/lib/huginn/draft";

// S14b — read-only inspection: huginnStatus distribution + latest Huginn
// AgentActions. ASCII-safe output (ids, statuses, counts — no French bodies).
//
//   npx tsx scripts/huginn/report-drafts.ts [--slug crm_demo] [--n 10]

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = argValue("--slug") ?? "crm_demo";
  const n = Number(argValue("--n") ?? 10);

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
      const emails = await prisma.activity.findMany({
        where: { type: "EMAIL", direction: "INBOUND" },
        select: { huginnStatus: true, messageId: true },
      });
      const byStatus = new Map<string, number>();
      for (const e of emails) {
        const key = e.huginnStatus ?? "(unprocessed)";
        byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
      }
      console.log(`=== Inbound emails (${emails.length}) by huginnStatus ===`);
      for (const [status, count] of [...byStatus.entries()].sort()) {
        console.log(`  ${status.padEnd(22)} ${count}`);
      }

      const actions = await prisma.agentAction.findMany({
        where: { category: HUGINN_CATEGORY },
        orderBy: { proposedAt: "desc" },
        take: n,
        select: {
          id: true,
          status: true,
          type: true,
          autonomyLevelAtProposal: true,
          promptKey: true,
          promptVersion: true,
          expiresAt: true,
          sources: true,
          trigger: true,
        },
      });
      console.log(`\n=== Latest ${actions.length} Huginn AgentActions ===`);
      for (const a of actions) {
        const sources = Array.isArray(a.sources) ? a.sources.length : 0;
        const trig = (a.trigger ?? {}) as { messageId?: string };
        console.log(
          `  ${a.id}  ${a.status.padEnd(9)} ${a.type}  sources=${sources}  ` +
            `level=${a.autonomyLevelAtProposal}  prompt=${a.promptKey}@v${a.promptVersion}  ` +
            `expires=${a.expiresAt?.toISOString().slice(0, 10) ?? "-"}  msg=${trig.messageId ?? "-"}`,
        );
      }
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

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const skips = await p.agentEvent.findMany({
    where: { module: "huginn", action: "skipped" },
    select: { data: true },
  });
  const by = new Map<string, number>();
  for (const s of skips) {
    const reason = (s.data as { reason?: string } | null)?.reason ?? "?";
    by.set(reason, (by.get(reason) ?? 0) + 1);
  }
  for (const [k, v] of by) console.log(`${k}: ${v}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => p.$disconnect());

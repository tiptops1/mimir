import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { HUGINN_CATEGORY } from "../../src/lib/huginn/draft";

// S14b dev helper — dump one drafted proposal + event/quarantine audit to a
// UTF-8 file (console is cp1252; never print French bodies).

const p = new PrismaClient();

async function main() {
  const out = process.argv[2] ?? "huginn-sample.txt";
  const action = await p.agentAction.findFirst({
    where: { category: HUGINN_CATEGORY, status: "PROPOSED" },
    orderBy: { proposedAt: "desc" },
  });
  const quarantineEvents = await p.agentEvent.findMany({
    where: { category: HUGINN_CATEGORY, action: "quarantined" },
    select: { entityId: true, data: true },
  });
  const eventCounts = await p.agentEvent.groupBy({
    by: ["module", "category", "action"],
    _count: true,
    where: { at: { gte: new Date(Date.now() - 3600_000) } },
  });
  writeFileSync(
    out,
    JSON.stringify({ action, quarantineEvents, eventCounts }, null, 2),
    "utf8",
  );
  console.log(`written: ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());

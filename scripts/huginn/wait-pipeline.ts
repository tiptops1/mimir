import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// S14b dev helper — poll until no inbound EMAIL activity is left unprocessed
// (or 4 min), then print the huginnStatus distribution. ASCII only.

const p = new PrismaClient();

async function main() {
  let left = -1;
  for (let i = 0; i < 80; i++) {
    left = await p.activity.count({
      where: { type: "EMAIL", direction: "INBOUND", huginnStatus: { isSet: false } },
    });
    if (left === 0) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const rows = await p.activity.findMany({
    where: { type: "EMAIL", direction: "INBOUND" },
    select: { huginnStatus: true },
  });
  const by = new Map<string, number>();
  for (const r of rows) {
    const k = r.huginnStatus ?? "(unprocessed)";
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  console.log("remaining unprocessed:", left);
  for (const [k, v] of [...by.entries()].sort()) console.log(`  ${k.padEnd(22)} ${v}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());

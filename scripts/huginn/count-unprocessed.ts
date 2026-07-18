import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// S14b dev helper — how many inbound EMAIL activities the scan would pick up.

const p = new PrismaClient();

async function main() {
  const unprocessed = await p.activity.count({
    where: { type: "EMAIL", direction: "INBOUND", huginnStatus: { isSet: false } },
  });
  const fixtures = await p.activity.count({
    where: {
      type: "EMAIL",
      direction: "INBOUND",
      huginnStatus: { isSet: false },
      messageId: { startsWith: "fixture:" },
    },
  });
  console.log(`unprocessed inbound emails: ${unprocessed} (fixtures: ${fixtures}, other: ${unprocessed - fixtures})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());

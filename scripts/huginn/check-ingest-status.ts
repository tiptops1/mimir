import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// S14b dev helper — poll until no KnowledgeDocument is PENDING/PROCESSING,
// then print doc-status + chunk counts. ASCII output only.

const p = new PrismaClient();

async function main() {
  for (let i = 0; i < 40; i++) {
    const pending = await p.knowledgeDocument.count({
      where: { status: { in: ["PENDING", "PROCESSING"] } },
    });
    if (pending === 0) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const docs = await p.knowledgeDocument.groupBy({ by: ["status"], _count: true });
  const chunks = await p.knowledgeChunk.count();
  console.log("docs by status:", JSON.stringify(docs));
  console.log("chunks:", chunks);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());

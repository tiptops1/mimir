import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncFireflies } from "../src/lib/fireflies";
import { enrichActivities, aiEnabled } from "../src/lib/ai-extract";

// Fireflies.ai → CRM. Polls recent call transcripts via the GraphQL API.
//
//   npm run sync:fireflies                 -> import recent transcripts
//   npm run sync:fireflies -- --limit=50   -> fetch more transcripts
//   npm run sync:fireflies -- --dry        -> fetch + match but write nothing
//
// Env: FIREFLIES_API_KEY, OWNER_EMAIL.

const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes("--dry");
  const limitArg = process.argv.find((a) => a.startsWith("--limit"));
  const limit = limitArg
    ? Number.parseInt(limitArg.split("=")[1] ?? "25", 10) || 25
    : 25;

  const r = await syncFireflies(prisma, { dry, limit });
  console.log(
    `${dry ? "[DRY] " : ""}Fireflies: ${r.transcripts} transcript(s), ` +
      `${r.logged} logged, ${r.unmatched} unmatched.`,
  );
  if (!dry && aiEnabled()) {
    const ai = await enrichActivities(prisma, { limit: 40 });
    console.log(`AI insight: enriched ${ai.enriched}, skipped ${ai.skipped}.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runImapSync } from "../src/lib/imap-sync";
import { enrichActivities, aiEnabled } from "../src/lib/ai-extract";

// Gmail/Workspace email sync over IMAP (App Password auth).
//
//   npm run sync:email                     -> incremental: only mail since last run
//   npm run sync:email -- --backfill=200   -> also import the last 200 messages/folder
//   npm run sync:email -- --dry            -> connect + parse but write nothing
//   npm run sync:email -- --no-ai          -> skip the Claude insight pass
//
// Env: IMAP_HOST, IMAP_PORT(=993), IMAP_USER, IMAP_PASSWORD (App Password),
//      OWNER_EMAIL (defaults to IMAP_USER), ANTHROPIC_API_KEY (optional).

const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes("--dry");
  const noAi = process.argv.includes("--no-ai");
  const backfillArg = process.argv.find((a) => a.startsWith("--backfill"));
  const backfill = backfillArg
    ? Number.parseInt(backfillArg.split("=")[1] ?? "200", 10) || 200
    : 0;

  const r = await runImapSync(prisma, { dry, backfill });
  console.log(
    `${dry ? "[DRY] " : ""}Scanned ${r.scanned} message(s) across ${r.mailboxes.join(", ")}. ` +
      `Logged ${r.matched}, created ${r.created} contact(s), ${r.pending} queued for review.`,
  );

  if (!dry && !noAi && aiEnabled()) {
    const ai = await enrichActivities(prisma, { limit: 60 });
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

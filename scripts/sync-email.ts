import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runImapSync } from "../src/lib/imap-sync";
import { runGmailSync } from "../src/lib/gmail-sync";
import { resolveTenant1Google } from "../src/lib/google-oauth";
import { touchGoogleLastSynced } from "../src/lib/integrations";
import { enrichActivities, aiEnabled } from "../src/lib/ai-extract";

// Email sync. Prefers tenant #1's OAuth Google connection (Gmail API); falls back
// to the legacy IMAP App-Password path if no Google account is connected.
//
//   npm run sync:email                     -> incremental: only mail since last run
//   npm run sync:email -- --backfill=200   -> first-run lookback (IMAP: messages/folder;
//                                             Gmail: days of history)
//   npm run sync:email -- --dry            -> connect + parse but write nothing
//   npm run sync:email -- --no-ai          -> skip the Claude insight pass
//
// Env: GOOGLE_* + CONTROL_DATABASE_URL (OAuth path) or IMAP_*/OWNER_EMAIL (legacy),
//      GEMINI_API_KEY or ANTHROPIC_API_KEY (optional, for the AI pass).

const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes("--dry");
  const noAi = process.argv.includes("--no-ai");
  const backfillArg = process.argv.find((a) => a.startsWith("--backfill"));
  const backfill = backfillArg
    ? Number.parseInt(backfillArg.split("=")[1] ?? "200", 10) || 200
    : 0;

  const google = await resolveTenant1Google();
  if (google) {
    const r = await runGmailSync(prisma, google.client, google.accountEmail, {
      dry,
      backfillDays: backfill || undefined,
    });
    if (!dry) await touchGoogleLastSynced(google.tenantId);
    console.log(
      `${dry ? "[DRY] " : ""}Gmail (${google.accountEmail}): scanned ${r.scanned}. ` +
        `Logged ${r.matched}, created ${r.created} contact(s), ${r.pending} queued.`,
    );
  } else {
    const r = await runImapSync(prisma, { dry, backfill });
    console.log(
      `${dry ? "[DRY] " : ""}IMAP: scanned ${r.scanned} message(s) across ${r.mailboxes.join(", ")}. ` +
        `Logged ${r.matched}, created ${r.created} contact(s), ${r.pending} queued for review.`,
    );
  }

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

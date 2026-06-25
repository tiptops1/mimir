import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runImapSync } from "../src/lib/imap-sync";
import { runGmailSync } from "../src/lib/gmail-sync";
import { syncCalendar } from "../src/lib/calendar-sync";
import { runGoogleCalendarSync } from "../src/lib/google-calendar-sync";
import { resolveTenant1Google } from "../src/lib/google-oauth";
import { touchGoogleLastSynced } from "../src/lib/integrations";
import { syncFireflies } from "../src/lib/fireflies";
import { enrichActivities, aiEnabled } from "../src/lib/ai-extract";
import { advanceSequences } from "../src/lib/sequences";

// One-shot: run every connected source, then the Claude insight pass once.
// Each source is independent — one failing (or unconfigured) doesn't stop the
// others. This is the same work the /api/cron route performs.
//
//   npm run sync:all
//   npm run sync:all -- --dry

const prisma = new PrismaClient();

async function run<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    const r = await fn();
    console.log(`✓ ${label}:`, r);
  } catch (e) {
    console.log(`· ${label}: skipped (${(e as Error).message})`);
  }
}

async function main() {
  const dry = process.argv.includes("--dry");

  // Prefer tenant #1's OAuth Google connection; else legacy IMAP/ICS.
  const google = await resolveTenant1Google();
  if (google) {
    await run("email", () =>
      runGmailSync(prisma, google.client, google.accountEmail, { dry }),
    );
    await run("calendar", () =>
      runGoogleCalendarSync(prisma, google.client, google.accountEmail, { dry }),
    );
    if (!dry) await touchGoogleLastSynced(google.tenantId);
  } else {
    await run("email", () => runImapSync(prisma, { dry }));
    await run("calendar", () => syncCalendar(prisma, { dry }));
  }
  await run("fireflies", () => syncFireflies(prisma, { dry }));

  if (!dry && aiEnabled()) {
    await run("ai-insight", () => enrichActivities(prisma, { limit: 80 }));
  } else if (!aiEnabled()) {
    console.log("· ai-insight: skipped (no GEMINI_API_KEY or ANTHROPIC_API_KEY)");
  }

  if (!dry) await run("sequences", () => advanceSequences(prisma));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

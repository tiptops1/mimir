import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncCalendar } from "../src/lib/calendar-sync";
import { runGoogleCalendarSync } from "../src/lib/google-calendar-sync";
import { resolveTenant1Google } from "../src/lib/google-oauth";
import { touchGoogleLastSynced } from "../src/lib/integrations";
import { enrichActivities, aiEnabled } from "../src/lib/ai-extract";

// Calendar → CRM. Prefers tenant #1's OAuth Google connection (Calendar API);
// falls back to the legacy read-only "secret iCal address" if none is connected.
//
//   npm run sync:calendar              -> log meetings
//   npm run sync:calendar -- --dry     -> parse + match but write nothing
//
// Env: GOOGLE_* + CONTROL_DATABASE_URL (OAuth) or GOOGLE_CALENDAR_ICS_URL/OWNER_EMAIL.

const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes("--dry");
  const google = await resolveTenant1Google();
  const r = google
    ? await runGoogleCalendarSync(prisma, google.client, google.accountEmail, { dry })
    : await syncCalendar(prisma, { dry });
  if (google && !dry) await touchGoogleLastSynced(google.tenantId);
  console.log(
    `${dry ? "[DRY] " : ""}Calendar${google ? ` (${google.accountEmail})` : ""}: ` +
      `${r.events} event(s) with external party, ` +
      `${r.logged} logged, ${r.updated} updated, ${r.unmatched} unmatched.`,
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

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { syncCalendar } from "../src/lib/calendar-sync";
import { enrichActivities, aiEnabled } from "../src/lib/ai-extract";

// Google Calendar → CRM via the read-only "secret iCal address" (no OAuth).
//
//   npm run sync:calendar              -> log meetings from the iCal feed
//   npm run sync:calendar -- --dry     -> parse + match but write nothing
//
// Env: GOOGLE_CALENDAR_ICS_URL, OWNER_EMAIL.

const prisma = new PrismaClient();

async function main() {
  const dry = process.argv.includes("--dry");
  const r = await syncCalendar(prisma, { dry });
  console.log(
    `${dry ? "[DRY] " : ""}Calendar: ${r.events} event(s) with external party, ` +
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

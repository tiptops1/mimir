import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runImapSync } from "../src/lib/imap-sync";
import { syncCalendar } from "../src/lib/calendar-sync";
import { syncFireflies } from "../src/lib/fireflies";
import { enrichActivities, aiEnabled } from "../src/lib/ai-extract";

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

  await run("email", () => runImapSync(prisma, { dry }));
  await run("calendar", () => syncCalendar(prisma, { dry }));
  await run("fireflies", () => syncFireflies(prisma, { dry }));

  if (!dry && aiEnabled()) {
    await run("ai-insight", () => enrichActivities(prisma, { limit: 80 }));
  } else if (!aiEnabled()) {
    console.log("· ai-insight: skipped (ANTHROPIC_API_KEY not set)");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

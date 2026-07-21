import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runFreyjaSyncForTenant } from "@/lib/freyja/sync";

// S25 — Freyja demo seed: 8 demo-provider campaigns for crm_demo (courtier
// flavor, Google/Meta-style mix encoded as channel + config.network), the
// FreyjaConfig singleton, and a 30-day insight backfill through the SAME sync
// code path the cron uses (one generator, no duplicate logic). Idempotent:
// campaigns upsert on (provider, externalId); the demo generator is a pure
// function of (campaign, day), so insight upserts converge.
//
//   npx tsx scripts/freyja/seed-demo-campaigns.ts

const CAMPAIGNS = [
  { externalId: "demo-search-emprunteur-idf", name: "Search — Assurance emprunteur Île-de-France", channel: "search", dailyBudget: 80, config: { archetype: "winner", network: "google" } },
  { externalId: "demo-search-rachat-credit", name: "Search — Rachat de crédit immobilier", channel: "search", dailyBudget: 60, config: { archetype: "steady", network: "google" } },
  { externalId: "demo-search-mutuelle-tns", name: "Search — Mutuelle santé TNS", channel: "search", dailyBudget: 45, config: { archetype: "loser", network: "google" } },
  { externalId: "demo-search-prevoyance-marque", name: "Search — Prévoyance dirigeants (marque)", channel: "search", dailyBudget: 25, config: { archetype: "winner", network: "google" } },
  { externalId: "demo-meta-leads-emprunteur", name: "Meta — Leads assurance emprunteur", channel: "social", dailyBudget: 50, config: { archetype: "fatiguing", network: "meta" } },
  { externalId: "demo-meta-retargeting-devis", name: "Meta — Retargeting devis abandonnés", channel: "social", dailyBudget: 30, config: { archetype: "winner", network: "meta" } },
  { externalId: "demo-meta-notoriete-video", name: "Meta — Notoriété courtage (vidéo)", channel: "social", dailyBudget: 35, config: { archetype: "loser", network: "meta" } },
  { externalId: "demo-display-remarketing-simulateur", name: "Display — Remarketing simulateur", channel: "display", dailyBudget: 20, config: { archetype: "steady", network: "google" } },
];

async function main() {
  const prisma = new PrismaClient();

  for (const c of CAMPAIGNS) {
    await prisma.campaign.upsert({
      where: { provider_externalId: { provider: "demo", externalId: c.externalId } },
      update: { name: c.name, channel: c.channel, dailyBudget: c.dailyBudget, config: c.config },
      create: { provider: "demo", ...c },
    });
  }

  await prisma.freyjaConfig.upsert({
    where: { singleton: "default" },
    update: {},
    create: { singleton: "default" },
  });

  const result = await runFreyjaSyncForTenant(prisma, { days: 30 });

  const insightCount = await prisma.campaignInsight.count();
  console.log(
    `Seeded ${CAMPAIGNS.length} campaigns (provider=demo), synced ${result.rowsUpserted} metric rows (30d), total insight rows: ${insightCount}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

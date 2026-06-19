import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { discoverWebsiteFree } from "../src/lib/enrich";

// Free, keyless website enrichment for companies that don't have a siteWeb yet.
// Uses Bing HTML (+ DuckDuckGo Lite, + Brave if BRAVE_API_KEY is set) and only
// saves a domain that strongly matches the company name. Best run LOCALLY from
// a residential IP — datacenter IPs get blocked by the search engines.
//
// Usage:
//   npm run enrich:websites               -> fill every empty siteWeb
//   npm run enrich:websites -- --dry      -> preview only, write nothing
//   npm run enrich:websites -- --limit=20 -> only the first 20 (oldest first)
//   npm run enrich:websites -- --force    -> also re-check companies that already have a site

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dry = process.argv.includes("--dry");
  const force = process.argv.includes("--force");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined;

  const companies = await prisma.company.findMany({
    where: force ? {} : { siteWeb: null },
    select: { id: true, nomSociete: true, enseigne: true, ville: true, siteWeb: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  console.log(
    `${dry ? "[DRY RUN] " : ""}Looking up websites for ${companies.length} ` +
      `compan${companies.length === 1 ? "y" : "ies"}…\n`,
  );

  let found = 0;
  let i = 0;
  for (const c of companies) {
    i++;
    const name = c.enseigne || c.nomSociete || "";
    if (!name.trim()) {
      console.log(`${i}/${companies.length} (no name) — skipped`);
      continue;
    }
    try {
      const site = await discoverWebsiteFree(name, c.ville);
      if (site && site !== c.siteWeb) {
        found++;
        if (!dry) {
          await prisma.company.update({ where: { id: c.id }, data: { siteWeb: site } });
        }
        console.log(`${i}/${companies.length} ✓ ${name} — ${site}`);
      } else {
        console.log(`${i}/${companies.length} · ${name} — no confident match`);
      }
    } catch (e) {
      console.warn(`${i}/${companies.length} ! ${name} — error: ${(e as Error).message}`);
    }
    // Be gentle with the search engines to avoid throttling.
    await sleep(2500);
  }

  console.log(
    `\n${dry ? "[DRY RUN] " : ""}Done. ${found} website${found === 1 ? "" : "s"} ` +
      `${dry ? "would be" : ""} found out of ${companies.length}.`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

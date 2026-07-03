import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// One-off inspection helper: why didn't the LinkedIn verification stage spend
// any SerpApi quota? Checks the quota row, the last few runs' stage-5 stats,
// and how many VALIDATED candidates actually have unchecked dirigeants.
// Usage: npx tsx scripts/leadone/debug-linkedin.ts

const prisma = new PrismaClient();

interface DirigeantJson {
  nom?: string | null;
  prenom?: string | null;
  linkedinChecked?: boolean;
}

async function main() {
  console.log("SERPAPI_KEY set locally:", Boolean(process.env.SERPAPI_KEY));

  const quota = await prisma.leadOneQuota.findUnique({ where: { provider: "serpapi" } });
  console.log("\nserpapi quota row:", JSON.stringify(quota, null, 2));

  const runs = await prisma.leadOneRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    select: { startedAt: true, trigger: true, finishedAt: true, error: true, stats: true },
  });
  console.log("\nlast 5 runs:");
  for (const r of runs) {
    const stats = r.stats as Record<string, unknown> | null;
    console.log(
      `- ${r.startedAt.toISOString()} (${r.trigger}) linkedin=${JSON.stringify(stats?.linkedin ?? "n/a")}`,
    );
  }

  const validated = await prisma.leadCandidate.findMany({
    where: { status: "VALIDATED" },
    select: { dirigeants: true },
  });
  let withName = 0;
  let unchecked = 0;
  for (const c of validated) {
    const dirigeants = (c.dirigeants ?? []) as DirigeantJson[];
    for (const d of dirigeants) {
      const name = [d.prenom, d.nom].filter(Boolean).join(" ").trim();
      if (!name) continue;
      withName++;
      if (!d.linkedinChecked) unchecked++;
    }
  }
  console.log(
    `\nVALIDATED dirigeants with a name: ${withName}, still unchecked: ${unchecked}`,
  );
}

main().finally(() => prisma.$disconnect());

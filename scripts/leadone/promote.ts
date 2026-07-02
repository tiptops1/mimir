import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { promoteCandidate } from "../../src/lib/leadone/promote";

// Lead One stage 5 — batch promotion CLI. Day-to-day promotion happens in the
// /leadone review queue (human approves); this wrapper exists for bulk moves
// of high-confidence leads. Same guards either way (promoteCandidate).
//
// Usage: npx tsx scripts/leadone/promote.ts --auto [--min-score=80] [--limit=100] [--dry]

export interface PromoteStats {
  promoted: number;
  rejected: number;
  skipped: number;
}

export async function runPromote(
  prisma: PrismaClient,
  opts: { minScore?: number; limit?: number; dry?: boolean } = {},
): Promise<PromoteStats> {
  const stats: PromoteStats = { promoted: 0, rejected: 0, skipped: 0 };
  const candidates = await prisma.leadCandidate.findMany({
    where: { status: "VALIDATED", confidence: { gte: opts.minScore ?? 80 } },
    orderBy: { confidence: "desc" },
    take: opts.limit ?? 100,
    select: { id: true, nomSociete: true, enseigne: true, siret: true, confidence: true },
  });

  for (const c of candidates) {
    if (opts.dry) {
      console.log(`[dry] would promote ${c.enseigne || c.nomSociete || c.siret} (${c.confidence})`);
      stats.promoted++;
      continue;
    }
    const r = await promoteCandidate(prisma, c.id, null);
    if (r.outcome === "PROMOTED") stats.promoted++;
    else if (r.outcome === "REJECTED") stats.rejected++;
    else stats.skipped++;
    console.log(
      `${r.outcome === "PROMOTED" ? "✓" : "✗"} ${c.enseigne || c.nomSociete || c.siret}` +
        `${r.reason ? ` — ${r.reason}` : ""}`,
    );
  }
  return stats;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  if (!process.argv.includes("--auto")) {
    console.log("Refusing to run without --auto (promotion is normally done in the /leadone UI).");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const dry = process.argv.includes("--dry");
  const scoreArg = process.argv.find((a) => a.startsWith("--min-score="));
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  runPromote(prisma, {
    dry,
    minScore: scoreArg ? Number.parseInt(scoreArg.split("=")[1], 10) : undefined,
    limit: limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined,
  })
    .then((s) => {
      console.log(
        `${dry ? "[DRY RUN] " : ""}Promotion: ${s.promoted} promoted, ` +
          `${s.rejected} rejected (duplicates/blocked), ${s.skipped} skipped.`,
      );
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient, type Prisma } from "@prisma/client";
import { verifyLinkedinProfile } from "../../src/lib/leadone/linkedin";

// Lead One stage 5 — LinkedIn profile verification for dirigeants of already
// VALIDATED candidates (the ones actually shown in the /leadone review queue).
// Quota-gated by serpapi.com's free tier (250/month) — a scarce budget, so it
// only ever spends on candidates a human is about to see, highest confidence
// first, and each dirigeant is looked up at most once ever (`linkedinChecked`).
//
// Usage: npx tsx scripts/leadone/verify-linkedin.ts [--dry] [--limit=50]

interface DirigeantJson {
  nom?: string | null;
  prenom?: string | null;
  qualite?: string | null;
  linkedinUrl?: string | null;
  linkedinChecked?: boolean;
}

export interface LinkedinStats {
  checked: number;
  found: number;
  budgetExhausted: boolean;
}

export async function runVerifyLinkedin(
  prisma: PrismaClient,
  opts: { limit?: number; dry?: boolean; deadline?: number } = {},
): Promise<LinkedinStats> {
  const stats: LinkedinStats = { checked: 0, found: 0, budgetExhausted: false };
  if (!process.env.SERPAPI_KEY) return stats;

  const candidates = await prisma.leadCandidate.findMany({
    where: { status: "VALIDATED" },
    orderBy: [{ confidence: "desc" }, { updatedAt: "asc" }],
    take: opts.limit ?? 200,
    select: { id: true, nomSociete: true, enseigne: true, dirigeants: true },
  });

  outer: for (const c of candidates) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const dirigeants = (c.dirigeants ?? []) as DirigeantJson[];
    const company = c.enseigne || c.nomSociete || "";
    let changed = false;

    for (const d of dirigeants) {
      if (opts.deadline && Date.now() > opts.deadline) break outer;
      if (d.linkedinChecked) continue;
      const name = [d.prenom, d.nom].filter(Boolean).join(" ").trim();
      if (!name) continue;

      const r = await verifyLinkedinProfile(prisma, name, company);
      if (r.status === "unavailable") {
        stats.budgetExhausted = true;
        break outer; // budget spent — resume on the next run
      }
      stats.checked++;
      changed = true;
      d.linkedinChecked = true;
      if (r.status === "found") {
        stats.found++;
        d.linkedinUrl = r.url;
        console.log(`✓ ${name} (${company}) — ${r.url}`);
      } else {
        console.log(`· ${name} (${company}) — no confident match`);
      }
    }

    if (changed && !opts.dry)
      await prisma.leadCandidate.update({
        where: { id: c.id },
        data: { dirigeants: dirigeants as unknown as Prisma.InputJsonValue },
      });
  }

  return stats;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  const prisma = new PrismaClient();
  const dry = process.argv.includes("--dry");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : undefined;
  runVerifyLinkedin(prisma, { dry, limit })
    .then((s) => {
      console.log(
        `${dry ? "[DRY RUN] " : ""}LinkedIn: ${s.found}/${s.checked} verified` +
          `${s.budgetExhausted ? " — budget exhausted, resuming next run" : ""}.`,
      );
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

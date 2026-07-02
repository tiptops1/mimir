import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { isValidated, scoreCandidate, validateEmail } from "../../src/lib/leadone/validate";

// Lead One stage 4 — validation & scoring of ENRICHED_CONTACT candidates.
// Free in-process checks only (syntax + DNS MX). Deterministic on the data we
// have, so a candidate that fails here is REJECTED outright (precision over
// volume) — re-checking identical data another day cannot change the outcome.
//
// Usage: npx tsx scripts/leadone/validate.ts [--dry] [--limit=200]

export interface ValidateStats {
  checked: number;
  validated: number;
  rejected: number;
}

export async function runValidate(
  prisma: PrismaClient,
  opts: { limit?: number; dry?: boolean; deadline?: number } = {},
): Promise<ValidateStats> {
  const stats: ValidateStats = { checked: 0, validated: 0, rejected: 0 };
  const candidates = await prisma.leadCandidate.findMany({
    where: { status: "ENRICHED_CONTACT" },
    orderBy: { updatedAt: "asc" },
    take: opts.limit ?? 500,
  });

  for (const c of candidates) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    stats.checked++;
    const emailStatus = c.email ? await validateEmail(c.email) : null;
    const scored = { ...c, emailStatus };
    const confidence = scoreCandidate(scored);
    const ok = isValidated(scored);
    if (ok) stats.validated++;
    else stats.rejected++;
    console.log(
      `${ok ? "✓" : "✗"} ${c.enseigne || c.nomSociete || c.siret} — score ${confidence}` +
        `${c.email ? ` (${c.email}: ${emailStatus})` : ""}`,
    );
    if (!opts.dry)
      await prisma.leadCandidate.update({
        where: { id: c.id },
        data: {
          emailStatus,
          confidence,
          status: ok ? "VALIDATED" : "REJECTED",
          lastError: ok ? null : "insufficient-contact",
        },
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
  runValidate(prisma, { dry, limit })
    .then((s) => {
      console.log(
        `${dry ? "[DRY RUN] " : ""}Validation: ${s.validated} validated, ` +
          `${s.rejected} rejected of ${s.checked}.`,
      );
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

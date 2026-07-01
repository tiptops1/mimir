import type { PrismaClient } from "@prisma/client";

// Structured stage-transition log (StageChange), the data source for Analytics
// v2 (velocity / conversion / win-rate trend). Call from EVERY path that writes
// Company.stage — the human-readable STAGE_CHANGE Activity on the fiche stays
// separate and unchanged.

export async function recordStageChange(
  prisma: PrismaClient,
  args: {
    companyId: string;
    from: string | null;
    to: string;
    userId?: string | null;
  },
): Promise<void> {
  if (args.from === args.to) return;
  await prisma.stageChange.create({
    data: {
      companyId: args.companyId,
      from: args.from,
      to: args.to,
      userId: args.userId ?? null,
    },
  });
}

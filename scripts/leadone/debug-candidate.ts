import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// One-off inspection helper: shows a candidate's state and any Company rows
// that could trip the promotion dedupe guards. Usage:
//   npx tsx scripts/leadone/debug-candidate.ts ASTORIA

const prisma = new PrismaClient();
const needle = process.argv[2] ?? "";

async function main() {
  const cand = await prisma.leadCandidate.findFirst({
    where: { nomSociete: { contains: needle, mode: "insensitive" } },
    select: { siret: true, nomSociete: true, status: true, lastError: true, siteWeb: true },
  });
  console.log("candidate:", JSON.stringify(cand, null, 2));
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { nomSociete: { contains: needle, mode: "insensitive" } },
        { enseigne: { contains: needle, mode: "insensitive" } },
        ...(cand?.siret ? [{ siret: cand.siret }] : []),
      ],
    },
    select: { id: true, nomSociete: true, enseigne: true, siret: true, siteWeb: true },
  });
  console.log("matching companies:", JSON.stringify(companies, null, 2));
}

main().finally(() => prisma.$disconnect());

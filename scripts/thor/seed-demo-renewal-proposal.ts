import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { proposeAction } from "@/lib/heimdallr/ledger";
import { getActivePrompt } from "@/lib/prompts";
import { isVectorIndexReady } from "@/lib/rag/vector-index";
import { retrieve } from "@/lib/rag/retrieve";
import { evaluateCompanyHealth, type CompanyHealthInput } from "@/lib/thor/health";
import {
  buildRenewalRetrievalQuery,
  draftRenewalOutreach,
  RENEWAL_DRAFT_EXPIRY_DAYS,
  THOR_MODULE,
  THOR_RENEWAL_ACTION_TYPE,
  THOR_RENEWAL_CATEGORY,
  THOR_RENEWAL_PROMPT_KEY,
} from "@/lib/thor/renewal";

// S22b one-off UI verification aid (heimdallr/seed-demo-proposal.ts twin) —
// leaves ONE real PROPOSED thor.renewal action in the inbox for manual
// approve/undo click-through. Not part of the seed chain.
//
//   npx tsx scripts/thor/seed-demo-renewal-proposal.ts

async function main() {
  const prisma = new PrismaClient();

  const companies = await prisma.company.findMany({
    select: {
      id: true,
      nomSociete: true,
      enseigne: true,
      siret: true,
      dernierContact: true,
      deals: { select: { status: true, isPrimary: true, closeDate: true, updatedAt: true } },
      activities: { orderBy: { date: "desc" }, take: 1, select: { sentiment: true, date: true } },
    },
  });
  const target = companies
    .map((c) => {
      const latestActivity = c.activities[0] ?? null;
      const primaryOpenDeal = c.deals.find((d) => d.isPrimary && d.status === "OPEN") ?? null;
      const input: CompanyHealthInput = {
        id: c.id,
        name: c.nomSociete ?? c.enseigne ?? c.siret,
        dernierContact: c.dernierContact,
        latestActivitySentiment: latestActivity?.sentiment ?? null,
        latestActivityDate: latestActivity?.date ?? null,
        wonDeals: c.deals.filter((d) => d.status === "WON").map((d) => ({ closeDate: d.closeDate })),
        primaryOpenDeal: primaryOpenDeal ? { updatedAt: primaryOpenDeal.updatedAt } : null,
      };
      return { company: c, health: evaluateCompanyHealth(input) };
    })
    .find(({ health }) => health.band === "at_risk" || health.band === "critical");
  if (!target) throw new Error("No at_risk/critical company in crm_demo");
  const { company, health } = target;
  const companyName = company.nomSociete ?? company.enseigne ?? company.siret;

  const config = await prisma.autonomyConfig.findUniqueOrThrow({ where: { category: THOR_RENEWAL_CATEGORY } });

  const companyInput = { companyId: company.id, companyName };
  const healthInput = { score: health.score, band: health.band, signals: health.signals };
  const indexReady = await isVectorIndexReady(prisma);
  const passages = indexReady
    ? await retrieve(prisma, buildRenewalRetrievalQuery(companyInput, healthInput), { limit: 4 })
    : [];
  const prompt = await getActivePrompt(prisma, THOR_RENEWAL_PROMPT_KEY);
  const draft = await draftRenewalOutreach(prisma, prompt, companyInput, healthInput, passages);
  if (!draft) throw new Error("Draft model unavailable");

  const action = await proposeAction(prisma, {
    module: THOR_MODULE,
    category: THOR_RENEWAL_CATEGORY,
    type: THOR_RENEWAL_ACTION_TYPE,
    payload: {
      companyId: company.id,
      companyName,
      band: health.band,
      score: health.score,
      signals: health.signals,
      subject: draft.subject,
      body: draft.body,
    },
    sources: passages,
    trigger: { kind: "health_sweep", companyId: company.id, band: health.band },
    entity: "COMPANY",
    entityId: company.id,
    autonomyLevelAtProposal: config.level,
    promptKey: prompt.key,
    promptVersion: prompt.version,
    reversible: true,
    expiresAt: new Date(Date.now() + RENEWAL_DRAFT_EXPIRY_DAYS * 86_400_000),
  });

  console.log(`Proposed AgentAction ${action.id} against "${companyName}" (band=${health.band}).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

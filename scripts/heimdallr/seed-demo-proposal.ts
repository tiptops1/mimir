import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";
import { proposeAction } from "../../src/lib/heimdallr/ledger";

// One-off demo aid for S8 — creates a single hand-inserted PROPOSED AgentAction
// against a real crm_demo company, so the approval inbox has something to
// click through. Not part of the tenant:seed-demo chain (manual, re-runnable).
//
//   npx tsx scripts/heimdallr/seed-demo-proposal.ts [slug=crm_demo]

async function main() {
  const slug = process.argv[2] ?? "crm_demo";
  const control = new ControlClient();
  const tenant = await control.tenant.findUnique({
    where: { slug },
    select: { connectionString: true },
  });
  if (!tenant) throw new Error(`Unknown tenant: ${slug}`);

  const prisma = new TenantClient({ datasourceUrl: decrypt(tenant.connectionString) });

  const company = await prisma.company.findFirst({
    orderBy: { nomSociete: "asc" },
    select: { id: true, nomSociete: true, notes: true },
  });
  if (!company) throw new Error(`No companies found in tenant "${slug}" — seed demo data first.`);

  const action = await proposeAction(prisma, {
    module: "crm",
    category: "crm.field_update",
    type: "crm.update_field",
    payload: {
      field: "notes",
      oldValue: company.notes ?? "",
      newValue: `${company.notes ?? ""}\n\nRelance effectuée le ${new Date().toLocaleDateString("fr-FR")} — client intéressé par une extension de garantie.`.trim(),
    },
    sources: [
      {
        docId: "demo-email-thread",
        chunkId: "1",
        quote: "Nous serions intéressés par une extension de garantie sur le contrat en cours.",
        score: 0.91,
      },
    ],
    trigger: { kind: "email", refs: { subject: "RE: Suivi contrat" } },
    entity: "COMPANY",
    entityId: company.id,
    autonomyLevelAtProposal: 1,
    reversible: true,
  });

  console.log(`Proposed AgentAction ${action.id} against "${company.nomSociete}" (${slug}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Seed Phase-1 config: tenant-defined custom field definitions. Idempotent
// (upsert by entity+key) — safe to re-run. These prove the "add a field as data,
// no migration" capability; a tenant adds/edits more via the (Phase-2) self-serve
// UI. Usage: npm run config:seed

const prisma = new PrismaClient();

const COMPANY_FIELDS: Array<{
  key: string;
  label: string;
  type: string;
  options?: string[];
  order: number;
}> = [
  { key: "logicielGestion", label: "Logiciel de gestion", type: "text", order: 1 },
  { key: "nombreContrats", label: "Nombre de contrats", type: "number", order: 2 },
  {
    key: "origineLead",
    label: "Origine du lead",
    type: "select",
    options: ["Recommandation", "Salon", "LinkedIn", "Site web", "Appel entrant", "Autre"],
    order: 3,
  },
  { key: "multiAgences", label: "Multi-agences", type: "bool", order: 4 },
];

async function main() {
  for (const f of COMPANY_FIELDS) {
    await prisma.fieldDefinition.upsert({
      where: { entity_key: { entity: "COMPANY", key: f.key } },
      update: {
        label: f.label,
        type: f.type,
        options: f.options ?? [],
        order: f.order,
        showInForm: true,
      },
      create: {
        entity: "COMPANY",
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? [],
        required: false,
        showInForm: true,
        order: f.order,
      },
    });
  }
  const count = await prisma.fieldDefinition.count();
  console.log(
    `Seeded ${COMPANY_FIELDS.length} COMPANY field definitions. Total: ${count}`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

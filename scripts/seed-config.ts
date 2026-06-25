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

// Starter outreach cadence (Phase-1 P1.2). Idempotent by name.
const SEQUENCES: Array<{ name: string; steps: unknown[] }> = [
  {
    name: "Prospection standard",
    steps: [
      { offsetDays: 0, channel: "EMAIL", title: "Email de prospection initial" },
      { offsetDays: 3, channel: "APPEL", title: "Appel de relance" },
      { offsetDays: 7, channel: "LINKEDIN", title: "Connexion LinkedIn + message" },
      { offsetDays: 14, channel: "EMAIL", title: "Email de dernière relance" },
    ],
  },
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

  for (const seq of SEQUENCES) {
    const existing = await prisma.sequence.findFirst({ where: { name: seq.name } });
    if (existing) {
      await prisma.sequence.update({
        where: { id: existing.id },
        data: { steps: seq.steps as never, active: true },
      });
    } else {
      await prisma.sequence.create({
        data: { name: seq.name, steps: seq.steps as never, active: true },
      });
    }
  }
  console.log(`Seeded ${SEQUENCES.length} sequence(s).`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Seed Phase-1 config: tenant-defined custom field definitions. Idempotent
// (upsert by entity+key) — safe to re-run. These prove the "add a field as data,
// no migration" capability; a tenant adds/edits more via the (Phase-2) self-serve
// UI. Usage: npm run config:seed

const prisma = new PrismaClient();

// Pipeline stages (Phase-1 follow-up: was a Prisma enum + a hardcoded array in
// src/lib/constants.ts). Today's 8 stages, expressed as data — see
// src/lib/stage-config.ts. Upserted by `key`, so re-running is safe.
const STAGES: Array<{
  key: string;
  label: string;
  order: number;
  accentClass: string;
  badgeClass: string;
  dotClass: string;
  isWon?: boolean;
  isLost?: boolean;
}> = [
  { key: "A_QUALIFIER", label: "À qualifier", order: 1, accentClass: "border-t-slate-400", badgeClass: "bg-slate-100 text-slate-700", dotClass: "bg-slate-400" },
  { key: "A_CONTACTER", label: "À contacter", order: 2, accentClass: "border-t-sky-400", badgeClass: "bg-sky-100 text-sky-700", dotClass: "bg-sky-400" },
  { key: "CONTACTE", label: "Contacté", order: 3, accentClass: "border-t-indigo-400", badgeClass: "bg-indigo-100 text-indigo-700", dotClass: "bg-indigo-400" },
  { key: "RDV_OBTENU", label: "RDV obtenu", order: 4, accentClass: "border-t-violet-400", badgeClass: "bg-violet-100 text-violet-700", dotClass: "bg-violet-400" },
  { key: "DEMO_REALISEE", label: "Démo réalisée", order: 5, accentClass: "border-t-amber-400", badgeClass: "bg-amber-100 text-amber-700", dotClass: "bg-amber-400" },
  { key: "PROPOSITION_ENVOYEE", label: "Proposition envoyée", order: 6, accentClass: "border-t-orange-400", badgeClass: "bg-orange-100 text-orange-700", dotClass: "bg-orange-400" },
  { key: "GAGNE", label: "Gagné", order: 7, accentClass: "border-t-emerald-500", badgeClass: "bg-emerald-100 text-emerald-700", dotClass: "bg-emerald-500", isWon: true },
  { key: "PERDU", label: "Perdu", order: 8, accentClass: "border-t-rose-400", badgeClass: "bg-rose-100 text-rose-700", dotClass: "bg-rose-400", isLost: true },
];

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

// Native field metadata (Phase-1 follow-up: "express Chris's current fields as
// config"). `key` is the real Prisma scalar column name on Company/Contact —
// these are read/written through that column, never via `customFields`.
// `section` matches the form groupings already on screen, so the dynamic
// renderer reproduces today's layout exactly. Order matches the current
// hardcoded JSX order in company-form.tsx / company-inline-editor.tsx.
const NATIVE_COMPANY_FIELDS: Array<{
  key: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
  order: number;
  section: string;
}> = [
  { key: "siret", label: "SIRET", type: "text", required: true, order: 1, section: "Identité" },
  { key: "siren", label: "SIREN", type: "text", order: 2, section: "Identité" },
  { key: "nomSociete", label: "Nom société", type: "text", order: 3, section: "Identité" },
  { key: "enseigne", label: "Enseigne", type: "text", order: 4, section: "Identité" },
  { key: "categorieEntreprise", label: "Catégorie", type: "text", order: 5, section: "Identité" },
  { key: "formeJuridique", label: "Forme juridique", type: "text", order: 6, section: "Identité" },
  { key: "dateCreation", label: "Date de création", type: "date", order: 7, section: "Identité" },
  { key: "trancheEffectifs", label: "Tranche d'effectifs", type: "text", order: 8, section: "Identité" },
  { key: "codeNaf", label: "Code NAF", type: "text", order: 9, section: "Identité" },
  { key: "libelleNaf", label: "Libellé NAF", type: "text", order: 10, section: "Identité" },

  // adresse is NOT seeded — it's full-width (sm:col-span-2) in the form, which
  // the generic single-column field loop doesn't express; stays hardcoded.
  { key: "codePostal", label: "Code postal", type: "text", order: 1, section: "Coordonnées" },
  { key: "ville", label: "Ville", type: "text", order: 2, section: "Coordonnées" },
  { key: "siteWeb", label: "Site web", type: "text", order: 3, section: "Coordonnées" },
  { key: "emailGenerique", label: "Email générique", type: "text", order: 4, section: "Coordonnées" },
  { key: "telephoneStandard", label: "Téléphone standard", type: "text", order: 5, section: "Coordonnées" },
  { key: "chiffreAffaires", label: "Chiffre d'affaires (€)", type: "number", order: 6, section: "Coordonnées" },
  // canalPrefere is NOT seeded here — it has a hardcoded French-label select
  // (CANAL_PREFERE_OPTIONS) that FieldDefinition.options (a plain string[] with
  // no separate label) can't express yet, so it stays a special-cased control
  // in the form, like stage/priorite/potentiel/specialties below.

  // priorite/potentiel are NOT seeded as NATIVE fields for the same reason
  // (label-mapped Prisma enums, e.g. "A" → "A — Haute") — they stay
  // special-cased controls (PRIORITE_OPTIONS/POTENTIEL_OPTIONS) in the form.
  { key: "canal", label: "Canal", type: "text", order: 1, section: "Qualification" },
  { key: "icpScore", label: "Score ICP", type: "number", order: 2, section: "Qualification" },
  { key: "nbCollaborateursEstime", label: "Nb collaborateurs estimé", type: "number", order: 3, section: "Qualification" },
  { key: "niveauDigitalisation", label: "Niveau digitalisation", type: "text", order: 4, section: "Qualification" },
  // notes is NOT seeded — it renders as a multiline <textarea>, which the
  // generic single-line NativeFieldControl doesn't support; stays hardcoded.
];

const NATIVE_CONTACT_FIELDS: Array<{
  key: string;
  label: string;
  type: string;
  required?: boolean;
  order: number;
  section: string;
}> = [
  { key: "prenom", label: "Prénom", type: "text", order: 1, section: "Identité" },
  { key: "nom", label: "Nom", type: "text", order: 2, section: "Identité" },
  { key: "fonction", label: "Fonction", type: "text", order: 3, section: "Identité" },
  { key: "email", label: "Email", type: "text", order: 1, section: "Coordonnées" },
  { key: "telephone", label: "Téléphone", type: "text", order: 2, section: "Coordonnées" },
  { key: "linkedinUrl", label: "LinkedIn", type: "text", order: 3, section: "Coordonnées" },
];

// Finances cockpit categories, expressed as config (FieldDefinition entity
// "FINANCE"). The Finances page reads these `options` for its category select;
// keeping them as data means they're editable without a code change. Kept in
// sync with DEFAULT_FINANCE_CATEGORIES in src/lib/finance.ts (inlined here to
// avoid a path-alias import in this standalone script).
const FINANCE_FIELDS: Array<{
  key: string;
  label: string;
  type: string;
  options?: string[];
  order: number;
  section: string;
}> = [
  {
    key: "category",
    label: "Catégorie",
    type: "select",
    options: [
      "Logiciels",
      "Marketing",
      "Bureau",
      "Matériel",
      "Sous-traitance",
      "Banque · frais",
      "Impôts · taxes",
      "Déplacements",
      "Revenu",
      "Autre",
    ],
    order: 1,
    section: "Finances",
  },
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
  for (const s of STAGES) {
    await prisma.stageDefinition.upsert({
      where: { key: s.key },
      update: {
        label: s.label,
        order: s.order,
        accentClass: s.accentClass,
        badgeClass: s.badgeClass,
        dotClass: s.dotClass,
        isWon: s.isWon ?? false,
        isLost: s.isLost ?? false,
      },
      create: {
        key: s.key,
        label: s.label,
        order: s.order,
        accentClass: s.accentClass,
        badgeClass: s.badgeClass,
        dotClass: s.dotClass,
        isWon: s.isWon ?? false,
        isLost: s.isLost ?? false,
      },
    });
  }
  console.log(`Seeded ${STAGES.length} pipeline stage definitions.`);

  for (const f of COMPANY_FIELDS) {
    await prisma.fieldDefinition.upsert({
      where: { entity_key: { entity: "COMPANY", key: f.key } },
      update: {
        label: f.label,
        type: f.type,
        options: f.options ?? [],
        order: f.order,
        showInForm: true,
        source: "CUSTOM",
        section: "Champs personnalisés",
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
        source: "CUSTOM",
        section: "Champs personnalisés",
      },
    });
  }
  console.log(`Seeded ${COMPANY_FIELDS.length} CUSTOM COMPANY field definitions.`);

  for (const f of NATIVE_COMPANY_FIELDS) {
    await prisma.fieldDefinition.upsert({
      where: { entity_key: { entity: "COMPANY", key: f.key } },
      update: {
        label: f.label,
        type: f.type,
        options: f.options ?? [],
        required: f.required ?? false,
        order: f.order,
        showInForm: true,
        source: "NATIVE",
        section: f.section,
      },
      create: {
        entity: "COMPANY",
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? [],
        required: f.required ?? false,
        showInForm: true,
        order: f.order,
        source: "NATIVE",
        section: f.section,
      },
    });
  }
  console.log(`Seeded ${NATIVE_COMPANY_FIELDS.length} NATIVE COMPANY field definitions.`);

  for (const f of NATIVE_CONTACT_FIELDS) {
    await prisma.fieldDefinition.upsert({
      where: { entity_key: { entity: "CONTACT", key: f.key } },
      update: {
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        order: f.order,
        showInForm: true,
        source: "NATIVE",
        section: f.section,
      },
      create: {
        entity: "CONTACT",
        key: f.key,
        label: f.label,
        type: f.type,
        options: [],
        required: f.required ?? false,
        showInForm: true,
        order: f.order,
        source: "NATIVE",
        section: f.section,
      },
    });
  }
  console.log(`Seeded ${NATIVE_CONTACT_FIELDS.length} NATIVE CONTACT field definitions.`);

  for (const f of FINANCE_FIELDS) {
    await prisma.fieldDefinition.upsert({
      where: { entity_key: { entity: "FINANCE", key: f.key } },
      update: {
        label: f.label,
        type: f.type,
        options: f.options ?? [],
        order: f.order,
        showInForm: true,
        source: "NATIVE",
        section: f.section,
      },
      create: {
        entity: "FINANCE",
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? [],
        required: false,
        showInForm: true,
        order: f.order,
        source: "NATIVE",
        section: f.section,
      },
    });
  }
  console.log(`Seeded ${FINANCE_FIELDS.length} FINANCE field definitions.`);

  const count = await prisma.fieldDefinition.count();
  console.log(`Total FieldDefinition rows: ${count}`);

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

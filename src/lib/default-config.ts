import type { PrismaClient } from "@prisma/client";

// The default tenant config (stages / field definitions / starter sequence),
// shared by `npm run config:seed` (scripts/seed-config.ts) and Phase-4
// self-serve provisioning (lib/provision.ts). Idempotent — every write is an
// upsert keyed by the stable key, so re-running never duplicates and never
// clobbers a tenant's own later edits beyond the seeded fields themselves.

interface StageSeed {
  key: string;
  label: string;
  order: number;
  accentClass: string;
  badgeClass: string;
  dotClass: string;
  isWon?: boolean;
  isLost?: boolean;
}

export const DEFAULT_STAGES: StageSeed[] = [
  { key: "A_QUALIFIER", label: "À qualifier", order: 1, accentClass: "border-t-slate-400", badgeClass: "bg-slate-100 text-slate-700", dotClass: "bg-slate-400" },
  { key: "A_CONTACTER", label: "À contacter", order: 2, accentClass: "border-t-sky-400", badgeClass: "bg-sky-100 text-sky-700", dotClass: "bg-sky-400" },
  { key: "CONTACTE", label: "Contacté", order: 3, accentClass: "border-t-indigo-400", badgeClass: "bg-indigo-100 text-indigo-700", dotClass: "bg-indigo-400" },
  { key: "RDV_OBTENU", label: "RDV obtenu", order: 4, accentClass: "border-t-violet-400", badgeClass: "bg-violet-100 text-violet-700", dotClass: "bg-violet-400" },
  { key: "DEMO_REALISEE", label: "Démo réalisée", order: 5, accentClass: "border-t-amber-400", badgeClass: "bg-amber-100 text-amber-700", dotClass: "bg-amber-400" },
  { key: "PROPOSITION_ENVOYEE", label: "Proposition envoyée", order: 6, accentClass: "border-t-orange-400", badgeClass: "bg-orange-100 text-orange-700", dotClass: "bg-orange-400" },
  { key: "GAGNE", label: "Gagné", order: 7, accentClass: "border-t-emerald-500", badgeClass: "bg-emerald-100 text-emerald-700", dotClass: "bg-emerald-500", isWon: true },
  { key: "PERDU", label: "Perdu", order: 8, accentClass: "border-t-rose-400", badgeClass: "bg-rose-100 text-rose-700", dotClass: "bg-rose-400", isLost: true },
];

interface FieldSeed {
  key: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
  order: number;
  section?: string;
}

// CUSTOM starter fields (customFields-backed) — prove the "field as data" path.
export const DEFAULT_CUSTOM_COMPANY_FIELDS: FieldSeed[] = [
  { key: "logicielGestion", label: "Logiciel de gestion", type: "text", order: 1 },
  { key: "nombreContrats", label: "Nombre de contrats", type: "number", order: 2 },
  { key: "origineLead", label: "Origine du lead", type: "select", options: ["Recommandation", "Salon", "LinkedIn", "Site web", "Appel entrant", "Autre"], order: 3 },
  { key: "multiAgences", label: "Multi-agences", type: "bool", order: 4 },
];

// NATIVE field metadata — `key` is the real Prisma scalar column. Fields with
// bespoke controls (stage/priorite/potentiel/canalPrefere/adresse/notes/
// specialties) are deliberately NOT seeded; see scripts/seed-config.ts history.
export const DEFAULT_NATIVE_COMPANY_FIELDS: FieldSeed[] = [
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
  { key: "codePostal", label: "Code postal", type: "text", order: 1, section: "Coordonnées" },
  { key: "ville", label: "Ville", type: "text", order: 2, section: "Coordonnées" },
  { key: "siteWeb", label: "Site web", type: "text", order: 3, section: "Coordonnées" },
  { key: "emailGenerique", label: "Email générique", type: "text", order: 4, section: "Coordonnées" },
  { key: "telephoneStandard", label: "Téléphone standard", type: "text", order: 5, section: "Coordonnées" },
  { key: "chiffreAffaires", label: "Chiffre d'affaires (€)", type: "number", order: 6, section: "Coordonnées" },
  { key: "canal", label: "Canal", type: "text", order: 1, section: "Qualification" },
  { key: "icpScore", label: "Score ICP", type: "number", order: 2, section: "Qualification" },
  { key: "nbCollaborateursEstime", label: "Nb collaborateurs estimé", type: "number", order: 3, section: "Qualification" },
  { key: "niveauDigitalisation", label: "Niveau digitalisation", type: "text", order: 4, section: "Qualification" },
];

export const DEFAULT_NATIVE_CONTACT_FIELDS: FieldSeed[] = [
  { key: "prenom", label: "Prénom", type: "text", order: 1, section: "Identité" },
  { key: "nom", label: "Nom", type: "text", order: 2, section: "Identité" },
  { key: "fonction", label: "Fonction", type: "text", order: 3, section: "Identité" },
  { key: "email", label: "Email", type: "text", order: 1, section: "Coordonnées" },
  { key: "telephone", label: "Téléphone", type: "text", order: 2, section: "Coordonnées" },
  { key: "linkedinUrl", label: "LinkedIn", type: "text", order: 3, section: "Coordonnées" },
];

// Kept in sync with DEFAULT_FINANCE_CATEGORIES in src/lib/finance.ts.
export const DEFAULT_FINANCE_FIELDS: FieldSeed[] = [
  { key: "category", label: "Catégorie", type: "select", options: ["Logiciels", "Marketing", "Bureau", "Matériel", "Sous-traitance", "Banque · frais", "Impôts · taxes", "Déplacements", "Revenu", "Autre"], order: 1, section: "Finances" },
];

export const DEFAULT_SEQUENCES: Array<{ name: string; steps: unknown[] }> = [
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

async function upsertFields(
  prisma: PrismaClient,
  entity: string,
  source: "NATIVE" | "CUSTOM",
  fields: FieldSeed[],
): Promise<void> {
  for (const f of fields) {
    const data = {
      label: f.label,
      type: f.type,
      options: f.options ?? [],
      required: f.required ?? false,
      showInForm: true,
      order: f.order,
      source,
      section: f.section ?? (source === "CUSTOM" ? "Champs personnalisés" : ""),
    };
    await prisma.fieldDefinition.upsert({
      where: { entity_key: { entity, key: f.key } },
      update: data,
      create: { entity, key: f.key, ...data },
    });
  }
}

/** Seed (or refresh) the default config on a tenant DB. Idempotent. */
export async function seedTenantConfig(prisma: PrismaClient): Promise<void> {
  for (const s of DEFAULT_STAGES) {
    const data = {
      label: s.label,
      order: s.order,
      accentClass: s.accentClass,
      badgeClass: s.badgeClass,
      dotClass: s.dotClass,
      isWon: s.isWon ?? false,
      isLost: s.isLost ?? false,
    };
    await prisma.stageDefinition.upsert({
      where: { key: s.key },
      update: data,
      create: { key: s.key, ...data },
    });
  }

  await upsertFields(prisma, "COMPANY", "CUSTOM", DEFAULT_CUSTOM_COMPANY_FIELDS);
  await upsertFields(prisma, "COMPANY", "NATIVE", DEFAULT_NATIVE_COMPANY_FIELDS);
  await upsertFields(prisma, "CONTACT", "NATIVE", DEFAULT_NATIVE_CONTACT_FIELDS);
  await upsertFields(prisma, "FINANCE", "NATIVE", DEFAULT_FINANCE_FIELDS);

  for (const seq of DEFAULT_SEQUENCES) {
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
}

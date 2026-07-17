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

interface AutonomySeed {
  category: string;
  label: string;
  maxLevel: number;
}

// Heimdallr autonomy categories (docs/mimir/events.md §3). All seeded at
// level 0 (off) — a tenant/module turns a category on explicitly. maxLevel 1
// on finance/legal is the never-graduates floor (defense in depth, §3).
export const DEFAULT_AUTONOMY_CATEGORIES: AutonomySeed[] = [
  { category: "huginn.support_reply", label: "Réponses support", maxLevel: 3 },
  { category: "muninn.rca_doc", label: "Documents d'analyse", maxLevel: 3 },
  { category: "bragi.content", label: "Contenu marketing", maxLevel: 3 },
  { category: "crm.field_update", label: "Mises à jour CRM", maxLevel: 3 },
  { category: "crm.task_create", label: "Création de tâches", maxLevel: 3 },
  { category: "finance.commitment", label: "Engagements financiers", maxLevel: 1 },
  { category: "legal.communication", label: "Communications juridiques", maxLevel: 1 },
];

interface PromptTemplateSeed {
  key: string;
  label: string;
  taskClass: string;
  module?: string;
  variables: string[];
  body: string;
}

// Skeleton rows for prompts that already exist in code today (ai-extract.ts,
// email-research.ts). Data only — those modules still use their own hardcoded
// template, unchanged; wiring them to read from PromptTemplate (and dropping
// the hardcoded broker name) is its own follow-up session (events.md §5).
export const DEFAULT_PROMPT_TEMPLATES: PromptTemplateSeed[] = [
  {
    key: "crm.ai_extract.system",
    label: "Extraction IA — email / réunion / appel",
    taskClass: "extract",
    variables: ["stageKeys"],
    body: `Tu es l'assistant CRM d'un courtier en assurances B2B (Avelior).
On te donne le contenu d'un email, d'une réunion ou d'un compte-rendu d'appel
avec un prospect. Tu en extrais le signal commercial utile au suivi.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la forme :
{
  "summary": "résumé neutre en 1-2 phrases (français)",
  "sentiment": "POSITIF" | "NEUTRE" | "NEGATIF",
  "interestLevel": "FORT" | "MOYEN" | "FAIBLE",
  "nextStep": "prochaine action recommandée (français)" | null,
  "actionItems": ["tâche concrète", ...],
  "suggestedStage": un de [{{stageKeys}}] | null
}

Règles : sois factuel, n'invente rien. Si l'information manque, mets null (ou []
pour actionItems). "suggestedStage" = la dernière étape réellement FRANCHIE dans
cet échange, jamais une étape seulement prévue, promise ou planifiée. Exemples :
un rendez-vous qui vient d'avoir lieu = RDV_OBTENU ; une démo seulement planifiée
n'est PAS DEMO_REALISEE (laisse RDV_OBTENU) ; une proposition évoquée mais pas
encore envoyée n'est PAS PROPOSITION_ENVOYEE. Dans le doute, choisis l'étape la
moins avancée.`,
  },
  {
    key: "outreach.email_draft.system",
    label: "Email de prospection",
    taskClass: "draft",
    variables: ["senderName", "greeting"],
    body: `Tu es {{senderName}}, du cabinet de courtage Avelior. Tu rédiges un email de prospection B2B personnalisé, en français, à un dirigeant d'un cabinet de courtage / d'agence d'assurance (prospect).

Objectif : obtenir un court échange (≈15 min). Style : professionnel, courtois, vouvoiement, concis (80–130 mots), UNE seule proposition d'action claire en fin de message.

Règles STRICTES :
- Personnalise UNIQUEMENT à partir du dossier fourni. N'invente RIEN : aucun chiffre, client, partenaire ou fait absent du dossier.
- Si le dossier est pauvre, reste crédible et générique plutôt que d'inventer.
- Commence par "{{greeting}}" et termine par une signature sur deux lignes : "{{senderName}}" puis "Avelior".
- Pas de promesse non fondée, pas de pièce jointe.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour : {"subject": "...", "body": "..."}. Dans "body", utilise de vrais sauts de ligne (\\n).`,
  },
  {
    key: "mimisbrunnr.health_classifier",
    label: "Classification santé — ingestion base de connaissances",
    taskClass: "classify",
    module: "mimisbrunnr",
    variables: ["chunks"],
    body: `Tu es un classifieur de conformité pour un courtier en assurances B2B français.
On te donne {{chunks}} extrait(s) de documents destinés à une base de connaissances.
Ta seule mission : détecter les DONNÉES DE SANTÉ À CARACTÈRE PERSONNEL, qui ne
doivent JAMAIS être stockées (périmètre HDS).

À signaler (flag: true) :
- questionnaires médicaux ou de santé, même partiels
- état de santé, pathologies, diagnostics, antécédents médicaux d'une personne
- traitements, prescriptions, médicaments associés à une personne
- arrêts de travail, invalidité, hospitalisation d'une personne identifiable
- toute donnée reliant une personne identifiable à sa santé

À NE PAS signaler (flag: false) :
- descriptions génériques de produits d'assurance santé/prévoyance (garanties,
  tarifs, conditions générales) sans données personnelles
- procédures internes, argumentaires commerciaux, réglementation
- données personnelles NON liées à la santé (adresse, SIRET, contrat auto...)

Règle d'or : dans le doute, signale (flag: true). Un faux positif se corrige ;
une donnée de santé stockée à tort ne se retire pas.

Réponds UNIQUEMENT avec un tableau JSON valide, sans texte autour, un objet par
extrait, dans l'ordre :
[{"i": 0, "flag": false, "categories": [], "confidence": 0.95, "reason": ""}, ...]
"categories" (si flag) parmi : ["questionnaire_medical", "pathologie",
"traitement", "arret_travail", "autre_sante"]. "reason" : justification courte
SANS recopier la donnée de santé elle-même.`,
  },
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

async function upsertAutonomyConfig(prisma: PrismaClient): Promise<void> {
  for (const a of DEFAULT_AUTONOMY_CATEGORIES) {
    const data = { label: a.label, maxLevel: a.maxLevel };
    await prisma.autonomyConfig.upsert({
      where: { category: a.category },
      update: data,
      create: { category: a.category, level: 0, ...data },
    });
  }
}

async function upsertPromptTemplates(prisma: PrismaClient): Promise<void> {
  for (const p of DEFAULT_PROMPT_TEMPLATES) {
    const data = {
      label: p.label,
      body: p.body,
      variables: p.variables,
      taskClass: p.taskClass,
      module: p.module ?? null,
      active: true,
    };
    await prisma.promptTemplate.upsert({
      where: { key_version: { key: p.key, version: 1 } },
      update: data,
      create: { key: p.key, version: 1, ...data },
    });
  }
}

// Default monthly AI spend cap (S5) — inside the memo's €15-40/tenant
// variable-cost range. Never clobber a live limit once a tenant has edited it.
const DEFAULT_AI_MONTHLY_LIMIT_USD = 20;

async function upsertAiBudget(prisma: PrismaClient): Promise<void> {
  await prisma.aiBudget.upsert({
    where: { singleton: "default" },
    update: {},
    create: { singleton: "default", monthlyLimitUsd: DEFAULT_AI_MONTHLY_LIMIT_USD },
  });
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

  await upsertAutonomyConfig(prisma);
  await upsertPromptTemplates(prisma);
  await upsertAiBudget(prisma);

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

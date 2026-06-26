import { z } from "zod";

export const loginSchema = z.object({
  email: z.email("Adresse email invalide.").trim(),
  password: z.string().min(1, "Mot de passe requis."),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Le nom doit comporter au moins 2 caractères.").trim(),
  email: z.email("Adresse email invalide.").trim(),
  password: z
    .string()
    .min(8, "Le mot de passe doit comporter au moins 8 caractères."),
});

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

const optionalInt = z
  .string()
  .trim()
  .optional()
  .transform((v) => {
    if (!v) return null;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  });

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("1"), z.string()])
  .optional()
  .transform((v) => v === "on" || v === "true" || v === "1");

export const companySchema = z.object({
  siret: z.string().trim().min(1, "Le SIRET est requis."),
  siren: optionalString,
  nomSociete: optionalString,
  enseigne: optionalString,
  categorieEntreprise: optionalString,
  formeJuridique: optionalString,
  codeNaf: optionalString,
  libelleNaf: optionalString,
  trancheEffectifs: optionalString,
  adresse: optionalString,
  codePostal: optionalString,
  ville: optionalString,
  siteWeb: optionalString,
  emailGenerique: optionalString,
  telephoneStandard: optionalString,
  chiffreAffaires: optionalInt,
  canalPrefere: z
    .enum(["PHONE", "EMAIL", "LINKEDIN"])
    .nullable()
    .optional()
    .catch(null),
  dateCreation: optionalDate,
  nbCollaborateursEstime: optionalInt,
  niveauDigitalisation: optionalString,
  icpScore: optionalInt,
  priorite: z.enum(["A", "B", "C"]).nullable().optional().catch(null),
  potentiel: z.enum(["FAIBLE", "MOYEN", "FORT"]).nullable().optional().catch(null),
  // Stages are config data (StageDefinition), not a fixed enum — the real
  // allow-list check happens server-side in actions/companies.ts against
  // getStageDefs(), so this only guards against an empty value.
  stage: z.string().trim().min(1).default("A_QUALIFIER"),
  canal: optionalString,
  notes: optionalString,
  specialiteSante: checkbox,
  specialitePrevoyance: checkbox,
  specialiteIard: checkbox,
  specialiteAuto: checkbox,
  specialiteRcPro: checkbox,
  specialiteEntreprises: checkbox,
  specialiteCollectives: checkbox,
  specialiteParticuliers: checkbox,
});

export const contactSchema = z.object({
  companyId: z.string().trim().min(1, "Société requise."),
  nom: optionalString,
  prenom: optionalString,
  fonction: optionalString,
  email: optionalString,
  telephone: optionalString,
  linkedinUrl: optionalString,
});

// Real allow-list check happens against getStageDefs() in the API route.
export const stageSchema = z.object({
  stage: z.string().trim().min(1),
});

export const activitySchema = z.object({
  companyId: z.string().trim().min(1),
  type: z.enum(["CALL", "EMAIL", "MEETING", "NOTE", "STAGE_CHANGE"]),
  note: optionalString,
});

// Finances cockpit. `direction` and `status` are derived/validated server-side
// in actions/finances.ts (from `kind` + statusOptionsFor), so this only shapes
// and coerces the raw form input. `amount` empty → 0 (handled in the action).
export const financeEntrySchema = z.object({
  kind: z
    .enum(["SUBSCRIPTION", "STAFF", "EXPENSE", "INVOICE"])
    .default("EXPENSE")
    .catch("EXPENSE"),
  label: z.string().trim().min(1, "Intitulé requis."),
  vendor: optionalString,
  category: optionalString,
  amount: optionalInt,
  currency: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : "EUR")),
  recurrence: z
    .enum(["NONE", "MONTHLY", "QUARTERLY", "ANNUAL"])
    .default("NONE")
    .catch("NONE"),
  status: optionalString,
  date: optionalDate,
  startDate: optionalDate,
  endDate: optionalDate,
  trialEndsAt: optionalDate,
  renewsAt: optionalDate,
  dueDate: optionalDate,
  autoRenew: checkbox,
  notes: optionalString,
  companyId: optionalString,
});

export const taskSchema = z.object({
  companyId: z.string().trim().min(1, "Société requise."),
  title: z.string().trim().min(1, "Intitulé requis."),
  type: z
    .enum(["RELANCE", "APPEL", "EMAIL", "RDV", "AUTRE"])
    .default("RELANCE"),
  dueDate: optionalDate,
  note: optionalString,
});

// Shared enum metadata (labels, ordering, colors) used across the UI.
// Values mirror the Prisma enums in prisma/schema.prisma.

export type StageValue =
  | "A_QUALIFIER"
  | "A_CONTACTER"
  | "CONTACTE"
  | "RDV_OBTENU"
  | "DEMO_REALISEE"
  | "PROPOSITION_ENVOYEE"
  | "GAGNE"
  | "PERDU";

export interface StageMeta {
  value: StageValue;
  label: string;
  // Tailwind classes for column accent + card badge
  accent: string;
  badge: string;
  dot: string;
}

// Ordered pipeline — matches the reference tab of the source spreadsheet.
export const PIPELINE_STAGES: StageMeta[] = [
  { value: "A_QUALIFIER", label: "À qualifier", accent: "border-t-slate-400", badge: "bg-slate-100 text-slate-700", dot: "bg-slate-400" },
  { value: "A_CONTACTER", label: "À contacter", accent: "border-t-sky-400", badge: "bg-sky-100 text-sky-700", dot: "bg-sky-400" },
  { value: "CONTACTE", label: "Contacté", accent: "border-t-indigo-400", badge: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-400" },
  { value: "RDV_OBTENU", label: "RDV obtenu", accent: "border-t-violet-400", badge: "bg-violet-100 text-violet-700", dot: "bg-violet-400" },
  { value: "DEMO_REALISEE", label: "Démo réalisée", accent: "border-t-amber-400", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  { value: "PROPOSITION_ENVOYEE", label: "Proposition envoyée", accent: "border-t-orange-400", badge: "bg-orange-100 text-orange-700", dot: "bg-orange-400" },
  { value: "GAGNE", label: "Gagné", accent: "border-t-emerald-500", badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  { value: "PERDU", label: "Perdu", accent: "border-t-rose-400", badge: "bg-rose-100 text-rose-700", dot: "bg-rose-400" },
];

export const STAGE_LABELS: Record<StageValue, string> = Object.fromEntries(
  PIPELINE_STAGES.map((s) => [s.value, s.label]),
) as Record<StageValue, string>;

export function stageMeta(value: string): StageMeta {
  return PIPELINE_STAGES.find((s) => s.value === value) ?? PIPELINE_STAGES[0];
}

export type PrioriteValue = "A" | "B" | "C";
export const PRIORITE_OPTIONS: { value: PrioriteValue; label: string; badge: string }[] = [
  { value: "A", label: "A — Haute", badge: "bg-rose-100 text-rose-700" },
  { value: "B", label: "B — Moyenne", badge: "bg-amber-100 text-amber-700" },
  { value: "C", label: "C — Basse", badge: "bg-slate-100 text-slate-600" },
];

export type PotentielValue = "FAIBLE" | "MOYEN" | "FORT";
export const POTENTIEL_OPTIONS: { value: PotentielValue; label: string }[] = [
  { value: "FAIBLE", label: "Faible" },
  { value: "MOYEN", label: "Moyen" },
  { value: "FORT", label: "Fort" },
];

// Preferred communication channel for reaching a prospect.
export type CanalValue = "PHONE" | "EMAIL" | "LINKEDIN";
export const CANAL_PREFERE_OPTIONS: { value: CanalValue; label: string }[] = [
  { value: "PHONE", label: "Téléphone" },
  { value: "EMAIL", label: "Email" },
  { value: "LINKEDIN", label: "LinkedIn" },
];

export type RoleValue = "ADMIN" | "MANAGER" | "USER";
export const ROLE_OPTIONS: { value: RoleValue; label: string }[] = [
  { value: "ADMIN", label: "Administrateur" },
  { value: "MANAGER", label: "Manager" },
  { value: "USER", label: "Utilisateur" },
];

// Specialty boolean columns on Company. `badge` colors the chip in the UI.
export const SPECIALTY_FIELDS = [
  { key: "specialiteSante", label: "Santé", badge: "bg-emerald-100 text-emerald-700" },
  { key: "specialitePrevoyance", label: "Prévoyance", badge: "bg-sky-100 text-sky-700" },
  { key: "specialiteIard", label: "IARD", badge: "bg-violet-100 text-violet-700" },
  { key: "specialiteAuto", label: "Auto", badge: "bg-amber-100 text-amber-700" },
  { key: "specialiteRcPro", label: "RC Pro", badge: "bg-rose-100 text-rose-700" },
  { key: "specialiteEntreprises", label: "Entreprises", badge: "bg-indigo-100 text-indigo-700" },
  { key: "specialiteCollectives", label: "Collectives", badge: "bg-teal-100 text-teal-700" },
  { key: "specialiteParticuliers", label: "Particuliers", badge: "bg-fuchsia-100 text-fuchsia-700" },
] as const;

export type SpecialtyKey = (typeof SPECIALTY_FIELDS)[number]["key"];

export const ACTIVITY_TYPES = [
  { value: "CALL", label: "Appel" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Rendez-vous" },
  { value: "NOTE", label: "Note" },
  { value: "STAGE_CHANGE", label: "Changement d'étape" },
] as const;

// Follow-up / task kinds. Values mirror Task.type in prisma/tenant/schema.prisma.
export const TASK_TYPES = [
  { value: "RELANCE", label: "Relance" },
  { value: "APPEL", label: "Appel" },
  { value: "EMAIL", label: "Email" },
  { value: "RDV", label: "Rendez-vous" },
  { value: "AUTRE", label: "Autre" },
] as const;

export type TaskTypeValue = (typeof TASK_TYPES)[number]["value"];

export const TASK_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TASK_TYPES.map((t) => [t.value, t.label]),
);

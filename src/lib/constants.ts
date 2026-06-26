// Shared enum metadata (labels, ordering, colors) used across the UI.
// Values mirror the Prisma enums in prisma/schema.prisma.
//
// Pipeline stages moved to config data — see src/lib/stage-config.ts
// (StageDefinition collection, seeded by scripts/seed-config.ts). They used to
// live here as a hardcoded PIPELINE_STAGES array / Prisma enum.

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

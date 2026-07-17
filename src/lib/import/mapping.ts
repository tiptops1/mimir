import { z } from "zod";
import type { FieldDef, FieldType } from "@/lib/field-config";

// S13b — column-mapping catalog + suggestion heuristic. Pure and client-safe
// (type-only import above; no DB, no crypto). The catalog is NATIVE Prisma
// columns (hardcoded per entity, schema is the spec) + the tenant's CUSTOM
// FieldDefinitions — so tenant vocabulary comes from config, not code.

export type ImportEntity = "COMPANY" | "CONTACT" | "DEAL";

export interface ImportTarget {
  entity: ImportEntity;
  key: string;
  label: string; // French, shown in the wizard select
  source: "NATIVE" | "CUSTOM";
  type: FieldType | "stage"; // "stage" coerces via StageDefinition labels
  /** Extra header spellings that should match this target. */
  synonyms?: string[];
  /** Free text — bundled for the health classifier before storage. */
  freeText?: boolean;
}

// NATIVE columns exposed to the import. Deliberately not the full schema:
// scoring/specialty columns are qualification work done in-app, not data a
// source CRM export carries under predictable names.
const NATIVE_TARGETS: ImportTarget[] = [
  // Company identity
  { entity: "COMPANY", key: "siret", label: "SIRET", source: "NATIVE", type: "text", synonyms: ["n siret", "numero siret", "siret etablissement"] },
  { entity: "COMPANY", key: "siren", label: "SIREN", source: "NATIVE", type: "text", synonyms: ["n siren", "numero siren"] },
  { entity: "COMPANY", key: "nomSociete", label: "Raison sociale", source: "NATIVE", type: "text", synonyms: ["societe", "nom societe", "nom de la societe", "entreprise", "company", "company name", "denomination"] },
  { entity: "COMPANY", key: "enseigne", label: "Enseigne", source: "NATIVE", type: "text", synonyms: ["nom commercial", "marque"] },
  { entity: "COMPANY", key: "formeJuridique", label: "Forme juridique", source: "NATIVE", type: "text", synonyms: ["statut juridique"] },
  { entity: "COMPANY", key: "adresse", label: "Adresse", source: "NATIVE", type: "text", synonyms: ["rue", "adresse postale", "address"] },
  { entity: "COMPANY", key: "codePostal", label: "Code postal", source: "NATIVE", type: "text", synonyms: ["cp", "zip", "zip code"] },
  { entity: "COMPANY", key: "ville", label: "Ville", source: "NATIVE", type: "text", synonyms: ["city", "commune"] },
  { entity: "COMPANY", key: "siteWeb", label: "Site web", source: "NATIVE", type: "text", synonyms: ["site", "website", "url", "site internet"] },
  { entity: "COMPANY", key: "emailGenerique", label: "Email générique", source: "NATIVE", type: "text", synonyms: ["email societe", "email entreprise", "email generique", "contact email societe"] },
  { entity: "COMPANY", key: "telephoneStandard", label: "Téléphone standard", source: "NATIVE", type: "text", synonyms: ["telephone societe", "tel standard", "standard"] },
  { entity: "COMPANY", key: "chiffreAffaires", label: "Chiffre d'affaires (€)", source: "NATIVE", type: "number", synonyms: ["ca", "ca annuel", "revenue", "chiffre d affaires"] },
  // Company pipeline
  { entity: "COMPANY", key: "stage", label: "Étape pipeline", source: "NATIVE", type: "stage", synonyms: ["etape", "statut", "stade", "stage", "pipeline"] },
  { entity: "COMPANY", key: "canal", label: "Canal", source: "NATIVE", type: "text", synonyms: ["canal d acquisition", "source"] },
  { entity: "COMPANY", key: "datePremierContact", label: "Date 1er contact", source: "NATIVE", type: "date", synonyms: ["premier contact", "date premier contact", "1er contact"] },
  { entity: "COMPANY", key: "dernierContact", label: "Dernier contact", source: "NATIVE", type: "date", synonyms: ["date dernier contact", "derniere interaction"] },
  { entity: "COMPANY", key: "notes", label: "Notes société", source: "NATIVE", type: "text", freeText: true, synonyms: ["notes", "commentaires", "commentaire", "remarques", "observations"] },
  // Contact
  { entity: "CONTACT", key: "nom", label: "Nom (contact)", source: "NATIVE", type: "text", synonyms: ["nom", "nom contact", "last name", "nom dirigeant"] },
  { entity: "CONTACT", key: "prenom", label: "Prénom (contact)", source: "NATIVE", type: "text", synonyms: ["prenom", "prenom contact", "first name", "prenom dirigeant"] },
  { entity: "CONTACT", key: "fonction", label: "Fonction (contact)", source: "NATIVE", type: "text", synonyms: ["poste", "role", "titre", "job title"] },
  { entity: "CONTACT", key: "email", label: "Email (contact)", source: "NATIVE", type: "text", synonyms: ["e mail", "mail", "email contact", "e mail contact", "adresse email"] },
  { entity: "CONTACT", key: "telephone", label: "Téléphone (contact)", source: "NATIVE", type: "text", synonyms: ["tel", "telephone", "portable", "mobile", "phone"] },
  { entity: "CONTACT", key: "linkedinUrl", label: "LinkedIn (contact)", source: "NATIVE", type: "text", synonyms: ["linkedin", "profil linkedin"] },
  { entity: "CONTACT", key: "isDecisionMaker", label: "Décideur", source: "NATIVE", type: "bool", synonyms: ["decideur", "decisionnaire", "decision maker"] },
  // Deal
  { entity: "DEAL", key: "title", label: "Opportunité (titre)", source: "NATIVE", type: "text", synonyms: ["opportunite", "affaire", "deal", "deal name"] },
  { entity: "DEAL", key: "product", label: "Produit (opportunité)", source: "NATIVE", type: "text", synonyms: ["produit", "offre"] },
  { entity: "DEAL", key: "amount", label: "Montant (opportunité, €)", source: "NATIVE", type: "number", synonyms: ["montant", "valeur", "amount", "budget"] },
];

/** Header/label normalization: accents, case, punctuation → single spaces. */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * NATIVE targets + the tenant's CUSTOM FieldDefinitions (config, not code).
 * CUSTOM text fields count as free text for the health-classifier bundle.
 */
export function buildTargetCatalog(
  customDefs: Partial<Record<ImportEntity, FieldDef[]>>,
): ImportTarget[] {
  const custom: ImportTarget[] = [];
  for (const entity of ["COMPANY", "CONTACT", "DEAL"] as const) {
    for (const def of customDefs[entity] ?? []) {
      if (def.source !== "CUSTOM") continue; // NATIVE defs mirror columns already in the catalog
      custom.push({
        entity,
        key: def.key,
        label: `${def.label} (champ personnalisé)`,
        source: "CUSTOM",
        type: def.type,
        synonyms: [def.label],
        freeText: def.type === "text",
      });
    }
  }
  return [...NATIVE_TARGETS, ...custom];
}

export interface ColumnMapping {
  header: string;
  target: { entity: ImportEntity; key: string; source: "NATIVE" | "CUSTOM" } | null;
  /** 1 = exact label/synonym match, 0.5 = token overlap. Absent when manual. */
  confidence?: number;
}

/**
 * Deterministic mapping suggestion — no AI. Exact normalized match against
 * label/key/synonyms wins; else a unique single-direction token containment
 * scores 0.5; else unmapped. Each target is suggested at most once.
 */
export function suggestMapping(
  headers: string[],
  catalog: ImportTarget[],
): ColumnMapping[] {
  const taken = new Set<ImportTarget>();
  const result: ColumnMapping[] = [];

  const exactIndex = new Map<string, ImportTarget>();
  for (const t of catalog) {
    for (const alias of [t.label, t.key, ...(t.synonyms ?? [])]) {
      const norm = normalizeHeader(alias);
      if (norm && !exactIndex.has(norm)) exactIndex.set(norm, t);
    }
  }

  for (const header of headers) {
    const norm = normalizeHeader(header);
    let match: ImportTarget | undefined;
    let confidence = 0;

    const exact = exactIndex.get(norm);
    if (exact && !taken.has(exact)) {
      match = exact;
      confidence = 1;
    } else if (norm) {
      // Token containment: every token of the shorter side appears in the longer.
      const headerTokens = norm.split(" ");
      const candidates = catalog.filter((t) => {
        if (taken.has(t)) return false;
        return [t.label, ...(t.synonyms ?? [])].some((alias) => {
          const aliasTokens = normalizeHeader(alias).split(" ").filter(Boolean);
          if (aliasTokens.length === 0) return false;
          const [shorter, longer] =
            aliasTokens.length <= headerTokens.length
              ? [aliasTokens, headerTokens]
              : [headerTokens, aliasTokens];
          return shorter.every((tok) => longer.includes(tok));
        });
      });
      if (candidates.length === 1) {
        match = candidates[0];
        confidence = 0.5;
      }
    }

    if (match) taken.add(match);
    result.push({
      header,
      target: match
        ? { entity: match.entity, key: match.key, source: match.source }
        : null,
      ...(match ? { confidence } : {}),
    });
  }
  return result;
}

// --- Zod boundary (mapping saved from the wizard form) ----------------------

export const columnMappingSchema = z.object({
  header: z.string(),
  target: z
    .object({
      entity: z.enum(["COMPANY", "CONTACT", "DEAL"]),
      key: z.string().min(1),
      source: z.enum(["NATIVE", "CUSTOM"]),
    })
    .nullable(),
});

export const importOptionsSchema = z.object({
  duplicatePolicy: z.enum(["skip", "fillEmpty"]).default("skip"),
});

export const mappingSchema = z
  .object({
    columns: z.array(columnMappingSchema).min(1),
    options: importOptionsSchema,
  })
  .refine(
    (m) =>
      m.columns.some(
        (c) =>
          c.target?.entity === "COMPANY" &&
          ["siret", "nomSociete", "enseigne"].includes(c.target.key),
      ),
    {
      message:
        "Au moins une colonne identifiant la société (SIRET, raison sociale ou enseigne) doit être mappée.",
    },
  );

export type ImportMappingConfig = z.infer<typeof mappingSchema>;

/** Look up a catalog target from a saved column mapping. */
export function resolveTarget(
  catalog: ImportTarget[],
  ref: { entity: ImportEntity; key: string; source: "NATIVE" | "CUSTOM" },
): ImportTarget | undefined {
  return catalog.find(
    (t) => t.entity === ref.entity && t.key === ref.key && t.source === ref.source,
  );
}

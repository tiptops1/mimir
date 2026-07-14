// Mustache-lite template rendering for outreach emails. Chosen adaptive-template
// strategy: most Lead One prospects only have a generic company address, so a
// missing variable collapses to "" and the surrounding whitespace is tidied —
// "Bonjour {{prenom}}," renders as "Bonjour Marie," or "Bonjour," and never
// "Bonjour ,". No conditionals, no loops: 4 variables cover the copy Chris writes.

export interface TemplateVars {
  prenom?: string | null;
  nom?: string | null;
  societe?: string | null;
  site?: string | null;
}

/** The variables the editor offers as insert buttons, with French labels. */
export const TEMPLATE_VAR_DEFS: { key: keyof TemplateVars; label: string }[] = [
  { key: "prenom", label: "Prénom du contact" },
  { key: "nom", label: "Nom du contact" },
  { key: "societe", label: "Société" },
  { key: "site", label: "Site web" },
];

/**
 * Replace {{var}} tokens with their values. Unknown or empty vars vanish, then
 * whitespace is cleaned up so the sentence still reads naturally:
 * spaces collapse, and a dangling space before punctuation is removed.
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const rendered = template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_m, key: string) => {
      const v = (vars as Record<string, string | null | undefined>)[key];
      return typeof v === "string" ? v.trim() : "";
    },
  );
  return rendered
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, " ") // "Bonjour  ," → "Bonjour ,"
        .replace(/ +([,.;:!?])/g, "$1") // "Bonjour ," → "Bonjour,"
        .trimEnd(),
    )
    .join("\n");
}

/** Sample values for the editor's live preview. */
export const PREVIEW_VARS: TemplateVars = {
  prenom: "Marie",
  nom: "Dupont",
  societe: "Cabinet Dupont Assurances",
  site: "cabinet-dupont.fr",
};

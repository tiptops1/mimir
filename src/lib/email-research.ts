import type { PrismaClient } from "@prisma/client";
import { callModel } from "./ai-extract";
import { fetchUniteLegale, discoverWebsiteFree } from "./enrich";
import { SPECIALTY_FIELDS } from "./constants";
import { loadStageDefs, stageLabelsFrom } from "./stage-config";
import { companyName, contactName } from "./display";

// "Research, then write." Two responsibilities:
//   1. buildProspectDossier — gather a documented, factual dossier on a prospect
//      from the CRM record + the activity timeline (with the AI insight we already
//      pay for) + live web research (French business registry + the firm's own
//      website). Everything is best-effort and wrapped so a slow/blocked source
//      never blocks email generation.
//   2. composeProspectingEmail — feed that dossier to the LLM (lib/ai-extract's
//      shared callModel) to draft a tailored French prospecting email.
//
// The dossier is grounded only in real data, and `sources` lists what was actually
// consulted so the UI can show the user the email is "documented", not invented.

export interface ProspectDossier {
  dossier: string;
  sources: string[];
  companyLabel: string;
  contactLabel: string | null;
  /** First name for the greeting, if known. */
  contactFirstName: string | null;
}

const SENTIMENT_FR: Record<string, string> = {
  POSITIF: "positif",
  NEUTRE: "neutre",
  NEGATIF: "négatif",
};

/** Fetch a page and reduce it to a plain-text snippet (best-effort, time-boxed). */
async function fetchPlainText(url: string): Promise<string | null> {
  try {
    const base = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(base, {
      headers: { "user-agent": "Mozilla/5.0 (Vision RM research)" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    if (!(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 1500) || null;
  } catch {
    return null;
  }
}

/**
 * Assemble a documented dossier on one prospect. `contactId` focuses it on a
 * specific decision-maker; omit it for a company-level dossier.
 */
export async function buildProspectDossier(
  prisma: PrismaClient,
  companyId: string,
  contactId?: string | null,
): Promise<ProspectDossier> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      contacts: { orderBy: { createdAt: "asc" } },
      activities: { orderBy: { date: "desc" }, take: 8 },
    },
  });
  if (!company) {
    return {
      dossier: "",
      sources: [],
      companyLabel: "",
      contactLabel: null,
      contactFirstName: null,
    };
  }

  const contact = contactId
    ? company.contacts.find((c) => c.id === contactId) ?? null
    : company.contacts.find((c) => c.isDecisionMaker) ?? company.contacts[0] ?? null;

  const companyLabel = companyName(company);
  const sources: string[] = [];
  const lines: string[] = [];

  // --- CRM section ---------------------------------------------------------
  lines.push(`Société : ${companyLabel}`);
  if (company.libelleNaf) lines.push(`Activité : ${company.libelleNaf}`);
  if (company.ville)
    lines.push(`Ville : ${company.ville}${company.codePostal ? ` (${company.codePostal})` : ""}`);
  if (company.trancheEffectifs) lines.push(`Effectif : ${company.trancheEffectifs}`);
  if (company.chiffreAffaires)
    lines.push(`Chiffre d'affaires connu : ${company.chiffreAffaires} €`);

  const specialties = SPECIALTY_FIELDS.filter(
    (s) => (company as Record<string, unknown>)[s.key],
  ).map((s) => s.label);
  if (specialties.length) lines.push(`Spécialités : ${specialties.join(", ")}`);
  const stageLabels = stageLabelsFrom(await loadStageDefs(prisma));
  lines.push(`Étape pipeline : ${stageLabels[company.stage] ?? company.stage}`);
  if (company.notes) lines.push(`Notes internes : ${company.notes}`);

  if (contact) {
    lines.push(
      `Interlocuteur : ${contactName(contact)}${contact.fonction ? ` — ${contact.fonction}` : ""}` +
        `${contact.isDecisionMaker ? " (décideur)" : ""}`,
    );
  }
  sources.push("Fiche CRM");

  // --- Activity timeline (with the AI insight we already generate) ---------
  if (company.activities.length) {
    lines.push("\nHistorique récent :");
    for (const a of company.activities) {
      const when = a.date.toLocaleDateString("fr-FR");
      const label =
        a.type === "EMAIL"
          ? a.direction === "OUTBOUND"
            ? "Email envoyé"
            : "Email reçu"
          : a.type === "MEETING"
            ? "Rendez-vous"
            : a.type === "CALL"
              ? "Appel"
              : "Note";
      const summary = a.aiSummary || a.subject || a.note || "";
      if (!summary) continue;
      const sentiment = a.sentiment ? ` [ressenti ${SENTIMENT_FR[a.sentiment] ?? a.sentiment}]` : "";
      lines.push(`- ${when} · ${label}${sentiment} : ${summary}`);
    }
    sources.push("Historique des échanges");
  }

  // --- Live web research (best-effort) -------------------------------------
  if (company.siren) {
    try {
      const reg = await fetchUniteLegale(company.siren);
      if (reg) {
        const bits: string[] = [];
        if (reg.nom_complet) bits.push(reg.nom_complet);
        if (reg.date_creation) bits.push(`créée le ${reg.date_creation}`);
        if (reg.libelle_activite_principale) bits.push(reg.libelle_activite_principale);
        if (reg.siege?.libelle_commune) bits.push(reg.siege.libelle_commune);
        if (bits.length) {
          lines.push(`\nRegistre officiel (recherche-entreprises.gouv.fr) : ${bits.join(" · ")}`);
          sources.push("Registre des entreprises (gouv.fr)");
        }
      }
    } catch {
      // best-effort
    }
  }

  // Site web : connu, ou découvert à la volée si absent.
  let siteWeb = company.siteWeb;
  if (!siteWeb) {
    try {
      siteWeb = await discoverWebsiteFree(companyLabel, company.ville);
    } catch {
      siteWeb = null;
    }
  }
  if (siteWeb) {
    const snippet = await fetchPlainText(siteWeb);
    if (snippet) {
      lines.push(`\nSite web (${siteWeb}) — extrait : ${snippet}`);
      sources.push(`Site web (${siteWeb})`);
    }
  }

  const firstName = contact?.prenom?.trim() || null;

  return {
    dossier: lines.join("\n").slice(0, 6000),
    sources,
    companyLabel,
    contactLabel: contact ? contactName(contact) : null,
    contactFirstName: firstName,
  };
}

export interface ComposedEmail {
  subject: string;
  body: string;
}

/** Pull a JSON object out of a (possibly fenced) model response. */
function parseComposed(text: string): ComposedEmail | null {
  const fenced = text.replace(/```json\s*|\s*```/g, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
    const subject = typeof o.subject === "string" ? o.subject.trim() : "";
    const body = typeof o.body === "string" ? o.body.trim() : "";
    if (!subject || !body) return null;
    return { subject, body };
  } catch {
    return null;
  }
}

/**
 * Draft a tailored French prospecting email from a dossier. Returns null if no AI
 * provider is configured or the model output can't be parsed.
 */
export async function composeProspectingEmail(
  prisma: PrismaClient,
  args: {
    dossier: string;
    senderName: string;
    companyLabel: string;
    contactLabel: string | null;
    contactFirstName: string | null;
  },
): Promise<ComposedEmail | null> {
  const greeting = args.contactFirstName ? `Bonjour ${args.contactFirstName},` : "Bonjour,";
  const system = `Tu es ${args.senderName}, du cabinet de courtage Avelior. Tu rédiges un email de prospection B2B personnalisé, en français, à un dirigeant d'un cabinet de courtage / d'agence d'assurance (prospect).

Objectif : obtenir un court échange (≈15 min). Style : professionnel, courtois, vouvoiement, concis (80–130 mots), UNE seule proposition d'action claire en fin de message.

Règles STRICTES :
- Personnalise UNIQUEMENT à partir du dossier fourni. N'invente RIEN : aucun chiffre, client, partenaire ou fait absent du dossier.
- Si le dossier est pauvre, reste crédible et générique plutôt que d'inventer.
- Commence par "${greeting}" et termine par une signature sur deux lignes : "${args.senderName}" puis "Avelior".
- Pas de promesse non fondée, pas de pièce jointe.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour : {"subject": "...", "body": "..."}. Dans "body", utilise de vrais sauts de ligne (\\n).`;

  const user = `Destinataire : ${args.contactLabel ?? "le dirigeant"} — société ${args.companyLabel}

DOSSIER (recherche documentée) :
${args.dossier || "(dossier limité — peu d'informations disponibles)"}`;

  const text = await callModel(prisma, "draft", system, user, { maxTokens: 800 });
  if (!text) return null;
  return parseComposed(text);
}

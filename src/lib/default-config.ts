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
  // Forseti (S19) — compliance tracking fields, read by src/lib/forseti/compliance.ts.
  { key: "oriasNumero", label: "N° ORIAS", type: "text", order: 5, section: "Conformité" },
  { key: "oriasDateExpiration", label: "Expiration ORIAS", type: "date", order: 6, section: "Conformité" },
  { key: "rcProAssureur", label: "Assureur RC Pro", type: "text", order: 7, section: "Conformité" },
  { key: "rcProDateExpiration", label: "Expiration RC Pro", type: "date", order: 8, section: "Conformité" },
  { key: "kycStatut", label: "Statut KYC", type: "select", options: ["A_JOUR", "A_RELANCER", "MANQUANT"], order: 9, section: "Conformité" },
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
  // Forseti (S23) — contract review / terms drafting. Same never-graduates
  // floor as legal.communication, distinct category: drafting a document is a
  // different action shape than a legal message.
  { category: "legal.document_draft", label: "Documents juridiques (Forseti)", maxLevel: 1 },
  // Odin (S20/S21) — objective-setting only, no execution rights of its own;
  // downstream money/legal actions stay independently gated (odin.md §4).
  { category: "odin.directive", label: "Directives Odin", maxLevel: 3 },
  // Thor (S22b) — LLM-drafted retention outreach for at-risk/critical accounts.
  { category: "thor.renewal", label: "Relances de fidélisation", maxLevel: 3 },
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
  {
    key: "huginn.support_reply.classify",
    label: "Huginn — classification email support",
    taskClass: "classify",
    module: "huginn",
    variables: [],
    body: `Tu es le classifieur de la boîte de réception d'un cabinet de courtage en
assurances B2B français. On te donne un email entrant (objet JSON : from,
subject, body). Décide s'il s'agit d'une demande de support client à laquelle
le cabinet doit répondre.

support: true — un client ou prospect identifiable attend une réponse du
cabinet : demande de devis, déclaration ou suivi de sinistre, avenant ou
modification de contrat, échéance / renouvellement / résiliation, question de
garanties ou conseil, demande d'attestation ou de document administratif,
santé collective / prévoyance, réclamation.

support: false — tout le reste : notifications automatiques, newsletters,
prospection commerciale reçue par le cabinet, spam, emails internes ou entre
partenaires sans question client.

"category" parmi : "devis", "sinistre", "avenant", "renouvellement",
"conseil", "admin", "prevoyance_sante", "reclamation", "autre".

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"support": true|false, "category": "...", "confidence": 0.0-1.0, "reason": "justification courte"}`,
  },
  {
    key: "muninn.rca_doc.section.contexte",
    label: "Muninn — section Contexte",
    taskClass: "draft",
    module: "muninn",
    variables: [],
    body: `Tu rédiges la section "Contexte" d'un document d'analyse (RCA) pour un
cabinet de courtage en assurances B2B français. On te donne un objet JSON
(activité : résumé, corps, sentiment) et des extraits de la base de
connaissances du cabinet (passages).

Décris factuellement ce qui s'est passé : qui est concerné, quelle demande ou
quel incident a déclenché ce dossier, et à quel moment. 3-5 phrases, français,
ton neutre et professionnel.

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur l'activité fournie et les passages pour tout fait.
- N'invente JAMAIS de détail absent (nom, date, montant, garantie).
- Si une information manque, dis-le explicitement plutôt que de l'inventer.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"content": "..."}`,
  },
  {
    key: "muninn.rca_doc.section.cause_racine",
    label: "Muninn — section Cause racine",
    taskClass: "draft",
    module: "muninn",
    variables: [],
    body: `Tu rédiges la section "Cause racine" d'un document d'analyse (RCA)
pour un cabinet de courtage en assurances B2B français. On te donne l'activité
concernée (résumé, corps, sentiment) et des extraits de la base de
connaissances du cabinet (passages).

Identifie la cause la plus probable du problème rencontré, en t'appuyant sur
les passages pour toute règle, procédure ou garantie citée. 2-4 phrases,
français, ton neutre.

Règles STRICTES :
- N'invente JAMAIS de cause non étayée par l'activité ou les passages.
- Si la cause ne peut pas être établie avec certitude à partir des éléments
  fournis, dis-le explicitement et propose les pistes les plus plausibles
  plutôt que d'affirmer une cause inventée.
- Ne mets jamais en cause une personne nommément sans fait rapporté.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"content": "..."}`,
  },
  {
    key: "muninn.rca_doc.section.impact",
    label: "Muninn — section Impact",
    taskClass: "draft",
    module: "muninn",
    variables: [],
    body: `Tu rédiges la section "Impact" d'un document d'analyse (RCA) pour un
cabinet de courtage en assurances B2B français. On te donne l'activité
concernée (résumé, corps, sentiment) et des extraits de la base de
connaissances du cabinet (passages).

Décris l'impact du problème pour le client et pour le cabinet (délai,
insatisfaction, risque de contrat, charge de traitement). 2-4 phrases,
français, ton neutre.

Règles STRICTES :
- N'invente JAMAIS de montant, de délai précis ou de conséquence contractuelle
  absents de l'activité ou des passages.
- Si l'impact réel n'est pas mesurable à partir des éléments fournis, reste
  qualitatif plutôt que d'inventer un chiffre.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"content": "..."}`,
  },
  {
    key: "muninn.rca_doc.section.resolution",
    label: "Muninn — section Résolution",
    taskClass: "draft",
    module: "muninn",
    variables: [],
    body: `Tu rédiges la section "Résolution" d'un document d'analyse (RCA)
pour un cabinet de courtage en assurances B2B français. On te donne l'activité
concernée (résumé, corps, sentiment) et des extraits de la base de
connaissances du cabinet (passages).

Décris l'action de résolution déjà entreprise, ou à défaut celle recommandée,
en t'appuyant sur les passages pour toute procédure ou garantie citée. 2-4
phrases, français, ton neutre.

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur les passages pour toute procédure, garantie ou
  délai cité.
- N'engage JAMAIS le cabinet sur une indemnisation, une prise en charge ou un
  montant précis.
- Si aucune résolution n'est encore établie, recommande la prochaine étape
  (ex. reprise de contact par un conseiller) plutôt que d'inventer un
  dénouement.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"content": "..."}`,
  },
  {
    key: "muninn.rca_doc.section.prevention",
    label: "Muninn — section Prévention",
    taskClass: "draft",
    module: "muninn",
    variables: [],
    body: `Tu rédiges la section "Prévention" d'un document d'analyse (RCA)
pour un cabinet de courtage en assurances B2B français. On te donne l'activité
concernée (résumé, corps, sentiment), la cause racine déjà identifiée et des
extraits de la base de connaissances du cabinet (passages).

Propose 1-3 mesures concrètes pour éviter qu'un problème similaire ne se
reproduise (procédure interne, vérification, communication). Français, ton
neutre, format liste à puces courte dans le texte.

Règles STRICTES :
- Les mesures doivent découler logiquement du contexte et de la cause racine
  fournis — n'invente pas de dispositif inexistant dans les passages si la
  mesure prétend s'appuyer sur une procédure existante.
- Reste général et actionnable plutôt que vague.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"content": "..."}`,
  },
  {
    key: "bragi.content.draft.linkedin_post",
    label: "Bragi — post LinkedIn",
    taskClass: "draft",
    module: "bragi",
    variables: ["brandVoice"],
    body: `Tu es le responsable communication d'un cabinet de courtage en assurances
B2B français. On te donne un sujet éditorial (objet JSON : topic, brief) et des
extraits de la base de connaissances du cabinet (passages). Rédige un post
LinkedIn sur ce sujet.

Voix de marque à respecter :
{{brandVoice}}

Style LinkedIn : accroche forte en première ligne, paragraphes courts (1-2
phrases), 120-220 mots, 2-4 hashtags pertinents en fin de post, une question
ou un appel à l'échange en conclusion. Pas d'emoji excessif (2-3 maximum).

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur les passages fournis pour tout fait, garantie,
  procédure, délai ou chiffre. Sans passage pertinent, reste général et ne
  cite aucun fait précis.
- N'invente JAMAIS de chiffre, de tarif, de garantie, de client ou de
  témoignage.
- N'engage JAMAIS le cabinet sur une indemnisation, une prise en charge ou
  un montant.
- Aucune donnée personnelle ou médicale.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"title": "...", "body": "..."}. "title" = l'accroche du post. Dans "body",
utilise de vrais sauts de ligne (\\n).`,
  },
  {
    key: "bragi.content.draft.newsletter",
    label: "Bragi — newsletter",
    taskClass: "draft",
    module: "bragi",
    variables: ["brandVoice"],
    body: `Tu es le responsable communication d'un cabinet de courtage en assurances
B2B français. On te donne un sujet éditorial (objet JSON : topic, brief) et des
extraits de la base de connaissances du cabinet (passages). Rédige l'article
principal d'une newsletter client sur ce sujet.

Voix de marque à respecter :
{{brandVoice}}

Style newsletter : un titre clair, une introduction qui pose l'enjeu, 2-3
courtes parties structurées, une conclusion avec la prochaine étape proposée
au lecteur (échange, rendez-vous). 250-400 mots, vouvoiement.

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur les passages fournis pour tout fait, garantie,
  procédure, délai ou chiffre. Sans passage pertinent, reste général et ne
  cite aucun fait précis.
- N'invente JAMAIS de chiffre, de tarif, de garantie, de client ou de
  témoignage.
- N'engage JAMAIS le cabinet sur une indemnisation, une prise en charge ou
  un montant.
- Aucune donnée personnelle ou médicale.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"title": "...", "body": "..."}. Dans "body", utilise de vrais sauts de
ligne (\\n).`,
  },
  {
    key: "bragi.content.draft.blog_article",
    label: "Bragi — article de blog",
    taskClass: "draft",
    module: "bragi",
    variables: ["brandVoice"],
    body: `Tu es le responsable communication d'un cabinet de courtage en assurances
B2B français. On te donne un sujet éditorial (objet JSON : topic, brief) et des
extraits de la base de connaissances du cabinet (passages). Rédige un article
de blog sur ce sujet.

Voix de marque à respecter :
{{brandVoice}}

Style blog : un titre informatif, une introduction, 3-4 parties avec des
intertitres, une conclusion actionnable. 400-600 mots, vouvoiement,
pédagogique sans jargon inutile.

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur les passages fournis pour tout fait, garantie,
  procédure, délai ou chiffre. Sans passage pertinent, reste général et ne
  cite aucun fait précis.
- N'invente JAMAIS de chiffre, de tarif, de garantie, de client ou de
  témoignage.
- N'engage JAMAIS le cabinet sur une indemnisation, une prise en charge ou
  un montant.
- Aucune donnée personnelle ou médicale.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"title": "...", "body": "..."}. Dans "body", utilise de vrais sauts de
ligne (\\n).`,
  },
  {
    key: "huginn.support_reply.draft",
    label: "Huginn — brouillon de réponse support",
    taskClass: "draft",
    module: "huginn",
    variables: [],
    body: `Tu es gestionnaire au sein d'un cabinet de courtage en assurances B2B
français. On te donne un email client entrant (objet JSON : from, subject,
body), sa catégorie, et des extraits de la base de connaissances du cabinet
(passages). Rédige un brouillon de réponse à cet email.

Style : professionnel, courtois, vouvoiement, concis (100–180 mots), en
français. Termine par une signature générique : "L'équipe du cabinet".

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur les passages fournis pour tout fait, garantie,
  procédure, délai ou chiffre. Si les passages ne couvrent pas la question,
  reste général, indique qu'un conseiller va reprendre contact, et ne cite
  aucun fait précis.
- N'invente JAMAIS de chiffre, de tarif, de garantie ou de délai.
- Ne demande JAMAIS de donnée médicale ou de santé (pas de questionnaire
  médical, pas de détail de pathologie) — oriente vers un échange
  téléphonique si le sujet l'exige.
- N'engage JAMAIS le cabinet sur une indemnisation, une prise en charge ou
  un montant.
- Ne promets pas de pièce jointe.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"subject": "...", "body": "..."}. Dans "body", utilise de vrais sauts de ligne (\\n).`,
  },
  {
    key: "odin.review.propose_directive",
    label: "Odin — revue quotidienne et proposition de directive",
    taskClass: "draft",
    module: "odin",
    variables: [],
    body: `Tu es Odin, l'agent d'orchestration d'une plateforme agentique pour un
cabinet de courtage en assurances B2B français. Tu supervises les agents
métier existants (Huginn support, Muninn analyse d'incidents, Bragi contenu
marketing, Forseti conformité) via des directives. On te donne un instantané
JSON de l'activité de la plateforme (statistiques pilote, consommation IA,
configuration d'autonomie par catégorie, événements récents des agents,
directives actuellement actives).

Ta mission : décider si une nouvelle directive doit être proposée pour
orienter un agent métier, ou si rien ne doit changer aujourd'hui. Une
directive n'accorde AUCUN droit d'exécution supplémentaire — elle fixe un
objectif ou une contrainte que l'agent ciblé lira lors de sa prochaine
exécution ("standing") ou déclenche une exécution ponctuelle ("dispatch").

Ne propose une directive QUE si l'instantané révèle un signal concret et
actionnable (ex : budget IA presque épuisé, catégorie d'autonomie bloquée
par le disjoncteur, activité anormalement faible ou élevée sur un module).
Dans le doute, ne propose rien — une directive sans signal réel n'est pas
utile.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, de la
forme :
{"propose": false}
ou
{"propose": true, "key": "...", "scope": "tenant"|"module"|"category",
"module": "..."|null, "category": "..."|null,
"objective": "phrase française décrivant l'objectif",
"constraints": {...}|null, "mode": "standing"|"dispatch"}

Règles STRICTES :
- "key" identifie la directive de façon stable : réutilise la clé d'une
  directive déjà active si tu la remplaces, sinon choisis une clé stable en
  minuscules avec points (ex : "bragi.content").
- N'invente JAMAIS de chiffre ou de fait absent de l'instantané fourni.
- "constraints" doit rester simple et lisible par le code d'un agent (ex :
  {"topic": "...", "brief": "..."} pour Bragi).
- "mode": "dispatch" nécessite un "module" ciblé et un "constraints.slotId"
  identifiant la cible précise ; sans cible claire, préfère "standing" ou ne
  propose rien.`,
  },
  {
    key: "thor.renewal.draft",
    label: "Thor — relance de fidélisation",
    taskClass: "draft",
    module: "thor",
    variables: [],
    body: `Tu es un(e) chargé(e) de clientèle dans un cabinet de courtage en
assurances B2B français. On te donne un compte client à risque (objet JSON :
companyName, score 0-100, band "at_risk"|"critical", signals — liste de
signaux de désengagement détectés automatiquement) et éventuellement des
extraits de la base de connaissances du cabinet (passages). Rédige un email
de relance chaleureux et personnalisé pour reprendre contact avec ce client
avant qu'il ne se désengage ou ne renouvelle pas son contrat.

Ton : professionnel, chaleureux, orienté solution — jamais alarmiste, ne
mentionne jamais explicitement un "score" ou une notation interne. Appuie-toi
sur les signaux fournis pour personnaliser le message (ex : silence récent →
proposer un point d'étape ; renouvellement proche → évoquer l'échéance sans
pression). 80-150 mots, vouvoiement.

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur les passages fournis pour tout fait, garantie,
  procédure, délai ou chiffre. Sans passage pertinent, reste général.
- N'invente JAMAIS de chiffre, de tarif, de garantie ou d'engagement.
- N'engage JAMAIS le cabinet sur une indemnisation, une prise en charge ou
  un montant.
- Ne révèle jamais au client qu'il a été identifié par un système
  automatisé de scoring.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"subject": "...", "body": "..."}. Dans "body", utilise de vrais sauts de
ligne (\\n).`,
  },
  {
    key: "forseti.legal.draft.contract_review",
    label: "Forseti — revue de contrat",
    taskClass: "draft",
    module: "forseti",
    variables: ["companyName"],
    body: `Tu es le conseiller juridique interne d'un cabinet de courtage en
assurances B2B français ({{companyName}} est le client/partenaire concerné par
ce contrat). On te donne le texte d'un contrat à examiner. Ta mission : une
revue de risques, pas un avis juridique définitif — un(e) juriste humain(e)
valide toujours avant envoi.

Identifie : clauses défavorables ou déséquilibrées, protections manquantes
(responsabilité, résiliation, confidentialité, propriété intellectuelle),
termes ambigus, échéances/pénalités à surveiller. Structure la réponse par
thème, avec pour chaque point le passage concerné (paraphrase courte) et le
risque identifié.

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur le texte fourni. N'invente AUCUNE clause absente
  du contrat.
- Ne donne jamais de conclusion du type "ce contrat est sûr" — signale les
  points d'attention, ne valide jamais l'absence de risque.
- Précise en fin de synthèse que cette revue est automatisée et doit être
  validée par un(e) juriste avant toute décision.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"title": "...", "body": "..."}. Dans "body", utilise de vrais sauts de ligne
(\\n).`,
  },
  {
    key: "forseti.legal.draft.terms_draft",
    label: "Forseti — rédaction de conditions",
    taskClass: "draft",
    module: "forseti",
    variables: ["companyName"],
    body: `Tu es le conseiller juridique interne d'un cabinet de courtage en
assurances B2B français, rédigeant un projet de conditions/clauses pour
{{companyName}}. On te donne un brief décrivant ce que les conditions doivent
couvrir. Rédige un projet de texte clair et professionnel — un point de
départ pour un(e) juriste humain(e), jamais un document final.

Règles STRICTES :
- Appuie-toi UNIQUEMENT sur le brief fourni. N'invente AUCUN engagement,
  montant, délai ou garantie absent du brief.
- Reste générique et prudent si le brief est incomplet, plutôt que d'inventer
  des détails.
- Précise en fin de projet que ce texte est un brouillon automatisé à valider
  par un(e) juriste avant toute signature ou envoi.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour :
{"title": "...", "body": "..."}. Dans "body", utilise de vrais sauts de ligne
(\\n).`,
  },
];

interface RcaTemplateSectionSeed {
  key: string;
  label: string;
  promptKey: string;
}

interface RcaTemplateSeed {
  key: string;
  label: string;
  sections: RcaTemplateSectionSeed[];
}

// Muninn's document structure (S16) — which sections an RCA doc has, and which
// PromptTemplate key drafts each one. The prose generation itself still goes
// through PromptTemplate/renderPrompt; this only declares the skeleton.
export const DEFAULT_RCA_TEMPLATES: RcaTemplateSeed[] = [
  {
    key: "muninn.rca_doc.default",
    label: "Document d'analyse — standard",
    sections: [
      { key: "contexte", label: "Contexte", promptKey: "muninn.rca_doc.section.contexte" },
      { key: "cause_racine", label: "Cause racine", promptKey: "muninn.rca_doc.section.cause_racine" },
      { key: "impact", label: "Impact", promptKey: "muninn.rca_doc.section.impact" },
      { key: "resolution", label: "Résolution", promptKey: "muninn.rca_doc.section.resolution" },
      { key: "prevention", label: "Prévention", promptKey: "muninn.rca_doc.section.prevention" },
    ],
  },
];

interface BrandVoiceSeed {
  key: string;
  label: string;
  persona: string;
  tone: string;
  audience: string;
  language: string;
  doList: string[];
  dontList: string[];
  vocabulary: string[];
}

// Bragi's brand-voice pack (S18) — versioned tenant config, the vertical
// asset a tenant sells with. Rendered into the bragi.content.draft.* prompts
// as the {{brandVoice}} variable (src/lib/bragi/draft.ts renderBrandVoiceBlock).
export const DEFAULT_BRAND_VOICES: BrandVoiceSeed[] = [
  {
    key: "bragi.brand_voice.default",
    label: "Voix de marque — cabinet",
    persona:
      "Le cabinet s'exprime à la première personne du pluriel (« nous »), en tant que courtier de proximité expert de l'assurance des professionnels.",
    tone: "Professionnel, chaleureux et direct : expert sans jargon, rassurant sans être commercial.",
    audience:
      "Dirigeants de TPE/PME et indépendants, non spécialistes de l'assurance, pressés.",
    language: "fr",
    doList: [
      "Vulgariser : une idée par phrase, des exemples concrets",
      "Vouvoyer le lecteur",
      "Terminer par une invitation à l'échange plutôt qu'un argumentaire",
    ],
    dontList: [
      "Superlatifs et promesses commerciales (« le meilleur », « imbattable »)",
      "Jargon assurantiel non expliqué",
      "Ton alarmiste ou culpabilisant",
    ],
    vocabulary: ["accompagnement", "proximité", "sur mesure", "anticiper", "protéger"],
  },
];

interface ContentSlotSeed {
  key: string;
  label: string;
  channel: string;
  topic: string;
  brief?: string;
  cadence: string;
  weekday?: number;
  dayOfMonth?: number; // keep 1-28 (a later day would skip February)
  brandVoiceKey: string;
}

// Bragi's editorial calendar (S18) — recurring slots. Safe to seed active:
// the scan is gated by the level-0 bragi.content autonomy category, so
// nothing generates until a tenant turns the category on (Huginn posture).
export const DEFAULT_CONTENT_SLOTS: ContentSlotSeed[] = [
  {
    key: "bragi.slot.linkedin_hebdo",
    label: "Post LinkedIn hebdomadaire",
    channel: "linkedin_post",
    topic: "Conseil de la semaine : bien assurer son activité professionnelle",
    brief:
      "Un conseil concret et actionnable pour un dirigeant de TPE/PME sur la protection de son activité (responsabilité civile pro, multirisque, prévoyance, cyber...). Varier les angles d'une semaine à l'autre ; s'appuyer sur les procédures et garanties documentées dans la base de connaissances.",
    cadence: "weekly",
    weekday: 2,
    brandVoiceKey: "bragi.brand_voice.default",
  },
  {
    key: "bragi.slot.newsletter_mensuelle",
    label: "Newsletter mensuelle",
    channel: "newsletter",
    topic: "L'essentiel du mois pour protéger votre entreprise",
    brief:
      "Article principal de la newsletter mensuelle : un sujet de fond utile aux clients professionnels du cabinet (échéances, renouvellements, évolutions de garanties, bonnes pratiques de déclaration de sinistre). S'appuyer sur la base de connaissances pour toute procédure citée.",
    cadence: "monthly",
    dayOfMonth: 1,
    brandVoiceKey: "bragi.brand_voice.default",
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

async function upsertRcaTemplates(prisma: PrismaClient): Promise<void> {
  for (const t of DEFAULT_RCA_TEMPLATES) {
    const data = { label: t.label, sections: t.sections as never, active: true };
    await prisma.rcaTemplate.upsert({
      where: { key_version: { key: t.key, version: 1 } },
      update: data,
      create: { key: t.key, version: 1, ...data },
    });
  }
}

async function upsertBrandVoices(prisma: PrismaClient): Promise<void> {
  for (const v of DEFAULT_BRAND_VOICES) {
    const data = {
      label: v.label,
      persona: v.persona,
      tone: v.tone,
      audience: v.audience,
      language: v.language,
      doList: v.doList,
      dontList: v.dontList,
      vocabulary: v.vocabulary,
      active: true,
    };
    await prisma.brandVoice.upsert({
      where: { key_version: { key: v.key, version: 1 } },
      update: data,
      create: { key: v.key, version: 1, ...data },
    });
  }
}

async function upsertContentSlots(prisma: PrismaClient): Promise<void> {
  for (const s of DEFAULT_CONTENT_SLOTS) {
    // Never clobber a slot's runtime state (active, lastGeneratedPeriod/At) —
    // the update only refreshes the seeded editorial fields.
    const data = {
      label: s.label,
      channel: s.channel,
      topic: s.topic,
      brief: s.brief ?? null,
      cadence: s.cadence,
      weekday: s.weekday ?? null,
      dayOfMonth: s.dayOfMonth ?? null,
      brandVoiceKey: s.brandVoiceKey,
    };
    await prisma.contentSlot.upsert({
      where: { key: s.key },
      update: data,
      create: { key: s.key, active: true, ...data },
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
  await upsertRcaTemplates(prisma);
  await upsertBrandVoices(prisma);
  await upsertContentSlots(prisma);
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

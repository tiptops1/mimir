// G2 evidence corpus — a modeled "typical month" of client email for the
// platform's assumed first vertical: a French multi-line insurance brokerage
// (cabinet de courtage) with a professional/commercial core (RC pro,
// multirisque, flotte auto, cyber) and a secondary collective health &
// protection line (santé collective / prévoyance).
//
// Purpose (see docs/mimir/decisions.md, G2 entry): stand in for the "ask the
// client what a typical month of client email contains" gate that G2 could not
// otherwise close without a real client. Every row carries a GROUND-TRUTH
// `containsHealthData` label so the S11 health classifier can be MEASURED
// against realistic inbound email (scripts/huginn/g2-evidence.ts), not just
// asserted. Synthetic — no real person, company, SIRET, or address.
//
// Reusable downstream as S14 (Huginn draft pipeline) fixtures: the same corpus
// is support-shaped inbound email to classify -> retrieve -> draft.
//
// French bodies are intentional (the vertical is French). The evidence script
// prints only ASCII ids/labels/aggregates, never these bodies — the repo's
// PowerShell console is cp1252 (see CLAUDE.md).

export type InboundCategory =
  | "devis" // demande de tarification / nouveau contrat
  | "sinistre" // declaration / suivi de sinistre
  | "avenant" // modification de contrat en cours
  | "renouvellement" // echeance / reconduction
  | "conseil" // question de garanties / conseil
  | "admin" // attestation, document, gestion administrative
  | "prevoyance_sante" // ligne sante collective / prevoyance
  | "reclamation"; // mecontentement / litige

export interface InboundEmail {
  id: string;
  from: string;
  subject: string;
  body: string;
  category: InboundCategory;
  /**
   * GROUND TRUTH: does the free text carry personal health data (donnee de
   * sante au sens RGPD art. 9) — diagnostic, arret de travail motive, acte
   * medical, reponse a un questionnaire medical, sinistre corporel detaille.
   * A generic coverage question ("qu'est-ce que ma mutuelle rembourse ?") is
   * NOT health data; a personal medical detail IS.
   */
  containsHealthData: boolean;
  /** Why this row is (or is borderline not) health data — for the eval. */
  note?: string;
}

export const SAMPLE_INBOX: InboundEmail[] = [
  // --- devis / tarification (core P&C, no health) ---
  {
    id: "M-01",
    from: "gerant@menuiserie-durand.example",
    subject: "Demande de devis RC Pro menuiserie",
    body: "Bonjour, je reprends l'atelier de mon pere (menuiserie, 4 salaries) et j'ai besoin d'un devis responsabilite civile professionnelle ainsi qu'une multirisque des locaux. Pouvez-vous me rappeler cette semaine ?",
    category: "devis",
    containsHealthData: false,
  },
  {
    id: "M-02",
    from: "compta@transports-vallee.example",
    subject: "Tarif flotte 6 vehicules",
    body: "Nous souhaitons assurer une flotte de 6 utilitaires (3 Kangoo, 3 Master). Merci de nous adresser une proposition tous risques avec bris de glace.",
    category: "devis",
    containsHealthData: false,
  },
  {
    id: "M-03",
    from: "dsi@fintech-nova.example",
    subject: "Assurance cyber - demande d'etude",
    body: "Suite a une exigence d'un de nos clients grands comptes, nous devons souscrire une cyber-assurance couvrant la responsabilite en cas de fuite de donnees. Quel plafond conseillez-vous pour un CA de 2,4 M EUR ?",
    category: "devis",
    containsHealthData: false,
  },
  {
    id: "M-04",
    from: "contact@boulangerie-lemoine.example",
    subject: "Devis local commercial",
    body: "Bonjour, ouverture d'une seconde boutique en septembre. Il me faut une multirisque professionnelle (incendie, degat des eaux, vol) pour un local de 90 m2. Merci.",
    category: "devis",
    containsHealthData: false,
  },
  {
    id: "M-05",
    from: "j.petit@archi-petit.example",
    subject: "RC decennale architecte",
    body: "Je m'installe en liberal comme architecte d'interieur. Besoin d'une RC pro et decennale. Quels documents dois-je vous fournir pour le devis ?",
    category: "devis",
    containsHealthData: false,
  },
  {
    id: "M-06",
    from: "resto.leclos@example",
    subject: "Devis assurance restaurant",
    body: "Restaurant 40 couverts, terrasse. Je veux comparer ma multirisque actuelle. Pouvez-vous chiffrer avec et sans la garantie perte d'exploitation ?",
    category: "devis",
    containsHealthData: false,
  },
  {
    id: "M-07",
    from: "garage.moreau@example",
    subject: "Assurance responsabilite garage automobile",
    body: "Bonjour, garage de reparation + depot-vente. J'aimerais un devis RC pro et une garantie vehicules confies a la clientele. Merci d'avance.",
    category: "devis",
    containsHealthData: false,
  },
  {
    id: "M-08",
    from: "coworking.hub@example",
    subject: "Tarification multirisque coworking",
    body: "Nous ouvrons un espace de coworking de 300 m2. Besoin multirisque + RC exploitation pour accueil du public. Rappel possible jeudi ?",
    category: "devis",
    containsHealthData: false,
  },
  {
    id: "M-09",
    from: "startup.greenbox@example",
    subject: "Contrat homme-cle",
    body: "Nos investisseurs demandent une assurance homme-cle sur nos deux fondateurs. Quelles infos vous faut-il pour etablir une proposition ?",
    category: "devis",
    containsHealthData: false,
    note: "Homme-cle CAN trigger a medical questionnaire later, but this first email carries no health detail.",
  },

  // --- sinistre / claims (some corporal -> health) ---
  {
    id: "M-10",
    from: "gerant@menuiserie-durand.example",
    subject: "Declaration sinistre degat des eaux atelier",
    body: "Une rupture de canalisation a inonde l'atelier ce week-end. Machines et stock de bois endommages. Je vous joins les photos, comment lancer l'expertise ?",
    category: "sinistre",
    containsHealthData: false,
  },
  {
    id: "M-11",
    from: "compta@transports-vallee.example",
    subject: "Accident de la circulation - vehicule 3",
    body: "Notre chauffeur a eu un accrochage sans tiers blesse, pare-chocs et aile avant enfonces. Constat en piece jointe. Merci de declarer le sinistre materiel.",
    category: "sinistre",
    containsHealthData: false,
  },
  {
    id: "M-12",
    from: "resto.leclos@example",
    subject: "Vol avec effraction nuit du 12",
    body: "Effraction cette nuit, caisse et materiel de cuisine emportes. Depot de plainte fait ce matin (recepisse joint). Quelle est la marche a suivre ?",
    category: "sinistre",
    containsHealthData: false,
  },
  {
    id: "M-13",
    from: "compta@transports-vallee.example",
    subject: "Accident du travail - salarie blesse",
    body: "Un de nos manutentionnaires s'est fracture la cheville en dechargeant une palette hier. Il est en arret pour 6 semaines, entorse grave avec operation prevue vendredi. Comment declarer au titre de la garantie individuelle accident ?",
    category: "sinistre",
    containsHealthData: true,
    note: "Corporal claim: named injury (fracture/entorse), surgery, arret de travail duration -> personal health data.",
  },
  {
    id: "M-14",
    from: "garage.moreau@example",
    subject: "Client blesse dans l'atelier",
    body: "Un client s'est coupe profondement la main sur une piece pendant qu'il attendait. Il a eu 8 points de suture aux urgences et parle d'une incapacite temporaire. Notre RC exploitation couvre-t-elle ce dommage corporel ?",
    category: "sinistre",
    containsHealthData: true,
    note: "Third-party bodily injury with medical detail (sutures, ITT) -> health data.",
  },
  {
    id: "M-15",
    from: "boulangerie-lemoine@example",
    subject: "Bris de vitrine",
    body: "La vitrine principale a ete brisee par un objet projete depuis la rue. Aucun blesse. Je souhaite declarer le bris de glace, devis du vitrier en piece jointe.",
    category: "sinistre",
    containsHealthData: false,
  },
  {
    id: "M-16",
    from: "j.petit@archi-petit.example",
    subject: "Reclamation client sur un chantier",
    body: "Un ancien client me met en cause pour des fissures apparues apres travaux. Il menace d'une procedure. Ma RC decennale doit-elle etre activee des maintenant ?",
    category: "sinistre",
    containsHealthData: false,
  },

  // --- avenant / policy changes ---
  {
    id: "M-17",
    from: "compta@transports-vallee.example",
    subject: "Ajout d'un vehicule a la flotte",
    body: "Nous venons d'acquerir un 7e utilitaire (immatriculation en piece jointe). Merci d'etablir l'avenant pour l'integrer a la flotte des lundi.",
    category: "avenant",
    containsHealthData: false,
  },
  {
    id: "M-18",
    from: "resto.leclos@example",
    subject: "Extension terrasse - mise a jour contrat",
    body: "La terrasse passe de 20 a 45 couverts cet ete. Faut-il un avenant a la multirisque ? Quel impact sur la cotisation ?",
    category: "avenant",
    containsHealthData: false,
  },
  {
    id: "M-19",
    from: "gerant@menuiserie-durand.example",
    subject: "Changement d'adresse atelier",
    body: "Nous demenageons l'atelier a une nouvelle adresse (voir piece jointe) au 1er du mois prochain. Merci de transferer les garanties sur le nouveau local.",
    category: "avenant",
    containsHealthData: false,
  },
  {
    id: "M-20",
    from: "dsi@fintech-nova.example",
    subject: "Augmentation plafond cyber",
    body: "Notre CA a double, nous voulons relever le plafond de la garantie cyber a 2 M EUR. Pouvez-vous nous envoyer l'avenant et la nouvelle prime ?",
    category: "avenant",
    containsHealthData: false,
  },
  {
    id: "M-21",
    from: "coworking.hub@example",
    subject: "Resiliation garantie annexe",
    body: "Nous n'utilisons plus le service de conciergerie, merci de retirer la garantie associee au prochain terme.",
    category: "avenant",
    containsHealthData: false,
  },

  // --- renouvellement / echeance ---
  {
    id: "M-22",
    from: "garage.moreau@example",
    subject: "Echeance annuelle - reconduction",
    body: "Mon contrat arrive a echeance le 30. Je souhaite le reconduire mais renegocier la franchise. Un point telephonique est-il possible ?",
    category: "renouvellement",
    containsHealthData: false,
  },
  {
    id: "M-23",
    from: "boulangerie-lemoine@example",
    subject: "Avis d'echeance recu - question",
    body: "J'ai recu l'avis d'echeance, la prime augmente de 8 %. Pouvez-vous m'expliquer la revalorisation avant que je reconduise ?",
    category: "renouvellement",
    containsHealthData: false,
  },
  {
    id: "M-24",
    from: "resto.leclos@example",
    subject: "Mise en concurrence avant renouvellement",
    body: "Avant de reconduire, j'aimerais comparer. Pouvez-vous me faire une contre-proposition sur la multirisque et la perte d'exploitation ?",
    category: "renouvellement",
    containsHealthData: false,
  },
  {
    id: "M-25",
    from: "archi-petit@example",
    subject: "Reconduction RC pro",
    body: "Je confirme la reconduction de ma RC pro pour l'annee a venir. Merci de m'adresser l'attestation a jour.",
    category: "renouvellement",
    containsHealthData: false,
  },

  // --- conseil / coverage questions (generic = NOT health) ---
  {
    id: "M-26",
    from: "coworking.hub@example",
    subject: "Question garantie perte d'exploitation",
    body: "En cas de fermeture administrative, la perte d'exploitation joue-t-elle ? J'aimerais comprendre les exclusions avant de decider.",
    category: "conseil",
    containsHealthData: false,
  },
  {
    id: "M-27",
    from: "startup.greenbox@example",
    subject: "Difference RC pro et RC exploitation",
    body: "Pouvez-vous m'expliquer simplement la difference entre RC professionnelle et RC exploitation ? Je ne sais pas laquelle me protege pour quoi.",
    category: "conseil",
    containsHealthData: false,
  },
  {
    id: "M-28",
    from: "dsi@fintech-nova.example",
    subject: "Cyber : la rancongiciel est-il couvert ?",
    body: "Notre contrat cyber couvre-t-il le paiement d'une rancon en cas de ransomware, ou seulement les frais de remediation ? Merci de preciser.",
    category: "conseil",
    containsHealthData: false,
  },
  {
    id: "M-29",
    from: "menuiserie-durand@example",
    subject: "Mes sous-traitants sont-ils couverts ?",
    body: "Quand je fais appel a un sous-traitant ponctuel, est-il couvert par ma RC pro ou doit-il avoir la sienne ? Question generale avant un gros chantier.",
    category: "conseil",
    containsHealthData: false,
  },
  {
    id: "M-30",
    from: "particulier.rousseau@example",
    subject: "Ma mutuelle rembourse-t-elle l'orthodontie ?",
    body: "Bonjour, dans le cadre du contrat sante collective de mon employeur, l'orthodontie adulte est-elle prise en charge et a quel taux ? Question de principe, sans dossier precis.",
    category: "conseil",
    containsHealthData: false,
    note: "BORDERLINE: generic reimbursement-rate question, no personal diagnosis -> NOT health data. Kept to test classifier over-flagging.",
  },

  // --- admin / attestations / documents ---
  {
    id: "M-31",
    from: "garage.moreau@example",
    subject: "Attestation d'assurance a jour",
    body: "J'ai besoin d'une attestation d'assurance RC pro datee de ce mois pour un appel d'offres. Pouvez-vous me l'envoyer par mail aujourd'hui ?",
    category: "admin",
    containsHealthData: false,
  },
  {
    id: "M-32",
    from: "compta@transports-vallee.example",
    subject: "Copie des conditions generales",
    body: "Merci de me renvoyer les conditions generales et particulieres de notre contrat flotte, je ne les retrouve plus.",
    category: "admin",
    containsHealthData: false,
  },
  {
    id: "M-33",
    from: "boulangerie-lemoine@example",
    subject: "Changement de RIB prelevement",
    body: "Nous avons change de banque. Voici le nouveau RIB pour le prelevement des cotisations. Merci de mettre a jour.",
    category: "admin",
    containsHealthData: false,
  },
  {
    id: "M-34",
    from: "j.petit@archi-petit.example",
    subject: "Justificatif pour les impots",
    body: "Pour ma comptabilite, il me faut un recapitulatif des cotisations versees l'an dernier. Pouvez-vous me le fournir ?",
    category: "admin",
    containsHealthData: false,
  },
  {
    id: "M-35",
    from: "resto.leclos@example",
    subject: "Mise a jour coordonnees",
    body: "Nouveau numero de portable et nouvelle adresse mail ci-dessous, merci de mettre a jour la fiche du cabinet.",
    category: "admin",
    containsHealthData: false,
  },

  // --- prevoyance / sante collective (health-heavy line) ---
  {
    id: "M-36",
    from: "rh@transports-vallee.example",
    subject: "Questionnaire medical - dirigeant homme-cle",
    body: "Voici le questionnaire medical rempli par notre dirigeant pour le contrat homme-cle : antecedents d'hypertension traitee depuis 2019, cholesterol, un episode d'infarctus en 2021 avec pose de stent. Merci de transmettre a l'assureur.",
    category: "prevoyance_sante",
    containsHealthData: true,
    note: "Full medical questionnaire with diagnoses -> the canonical HDS-scope content.",
  },
  {
    id: "M-37",
    from: "salarie.bernard@transports-vallee.example",
    subject: "Arret de travail - prevoyance",
    body: "Je suis en arret depuis 3 semaines suite a une hernie discale operee. Mon medecin prevoit encore 2 mois de convalescence. Comment activer les indemnites journalieres de la prevoyance collective ?",
    category: "prevoyance_sante",
    containsHealthData: true,
    note: "Arret de travail with named pathology + surgery -> health data / IJ prevoyance.",
  },
  {
    id: "M-38",
    from: "rh@fintech-nova.example",
    subject: "Affiliation nouveau salarie - sante collective",
    body: "Nouvelle embauche a affilier a la mutuelle. Elle signale une affection de longue duree (diabete de type 1, sous pompe a insuline) et demande si le contrat couvre son traitement sans delai de carence.",
    category: "prevoyance_sante",
    containsHealthData: true,
    note: "ALD / chronic condition disclosed on affiliation -> health data.",
  },
  {
    id: "M-39",
    from: "salarie.dupont@menuiserie-durand.example",
    subject: "Remboursement soins - question mutuelle",
    body: "Ma fille doit etre operee des amygdales le mois prochain (ORL) et aura besoin de seances d'orthophonie ensuite. Quel est le reste a charge avec notre mutuelle d'entreprise ?",
    category: "prevoyance_sante",
    containsHealthData: true,
    note: "Named procedure + follow-up care for an identified person -> health data.",
  },

  // --- reclamation / litige ---
  {
    id: "M-40",
    from: "resto.leclos@example",
    subject: "Delai de reglement sinistre trop long",
    body: "Cela fait 6 semaines que mon dossier degat des eaux est en attente d'expertise. C'est inacceptable, je perds du chiffre. Que comptez-vous faire ?",
    category: "reclamation",
    containsHealthData: false,
  },
  {
    id: "M-41",
    from: "garage.moreau@example",
    subject: "Desaccord sur une exclusion",
    body: "Mon sinistre a ete refuse au motif d'une exclusion que personne ne m'a jamais expliquee a la souscription. Je conteste et demande un reexamen du dossier.",
    category: "reclamation",
    containsHealthData: false,
  },
  {
    id: "M-42",
    from: "compta@transports-vallee.example",
    subject: "Erreur de facturation cotisation",
    body: "Nous avons ete preleves deux fois ce mois-ci pour le contrat flotte. Merci de regulariser rapidement et de confirmer le remboursement.",
    category: "reclamation",
    containsHealthData: false,
  },
];

/** Ground-truth aggregates, computed once so scripts and docs agree. */
export const CORPUS_STATS = {
  total: SAMPLE_INBOX.length,
  healthTrue: SAMPLE_INBOX.filter((e) => e.containsHealthData).length,
  byCategory: SAMPLE_INBOX.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {}),
};

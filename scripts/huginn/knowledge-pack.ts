// S14b — demo support knowledge pack for the crm_demo tenant (French courtier
// vertical). Data, not code: these docs are ingested through the REAL
// Mimisbrunnr pipeline (chunk -> health classify -> embed -> store) by
// scripts/huginn/seed-knowledge.ts, so drafts are grounded in retrievable
// passages. Aligned with the SAMPLE_INBOX categories. Synthetic, generic,
// deliberately free of any personal (a fortiori health) data.

export interface KnowledgeDoc {
  title: string;
  text: string;
}

export const KNOWLEDGE_PACK: KnowledgeDoc[] = [
  {
    title: "Procédure de déclaration de sinistre",
    text: `Déclaration de sinistre — procédure standard du cabinet.

Le client doit déclarer tout sinistre au cabinet dans les 5 jours ouvrés suivant sa survenance (2 jours ouvrés en cas de vol, conformément aux conditions générales usuelles). La déclaration peut se faire par email ou par téléphone auprès de son gestionnaire.

Pièces à fournir pour ouvrir le dossier : description des circonstances (date, lieu, nature des dommages), photos des dommages si possible, devis ou factures des biens endommagés, dépôt de plainte en cas de vol ou de vandalisme, constat amiable en cas de sinistre automobile.

Une fois le dossier complet transmis à la compagnie, un accusé de réception est adressé au client sous 48 heures. Le cabinet assure le suivi avec la compagnie et informe le client à chaque étape : ouverture du dossier, passage de l'expert le cas échéant, position de la compagnie, règlement de l'indemnité. Les délais d'indemnisation dépendent de la compagnie et de la complexité du dossier ; le cabinet ne peut pas s'engager sur un montant ou un délai à la place de l'assureur.`,
  },
  {
    title: "Attestations et documents administratifs",
    text: `Attestations d'assurance — délais et modalités d'édition.

Le cabinet édite les attestations d'assurance courantes (responsabilité civile professionnelle, multirisque, flotte automobile) sous 24 à 48 heures ouvrées à compter de la demande. La demande se fait par simple email au gestionnaire en précisant : le contrat concerné, l'usage de l'attestation (appel d'offres, bailleur, donneur d'ordre) et, le cas échéant, le destinataire à mentionner.

Pour les attestations spécifiques exigées par un donneur d'ordre (mentions particulières, montants de garantie à faire apparaître), un délai supplémentaire peut être nécessaire si la compagnie doit émettre le document elle-même.

Les autres documents contractuels (conditions particulières, échéanciers, relevés de situation) sont disponibles sur demande auprès du gestionnaire. En cas de perte des documents contractuels, un duplicata peut être demandé à la compagnie.`,
  },
  {
    title: "Avenants et modifications de contrat",
    text: `Modification d'un contrat en cours (avenant) — fonctionnement.

Toute évolution de l'activité assurée doit être signalée au cabinet pour rester correctement couvert : déménagement ou ouverture d'un nouveau local, embauche significative, nouveau véhicule dans la flotte, nouvelle activité ou nouveau matériel, évolution du chiffre d'affaires déclaré.

Sur signalement, le cabinet analyse l'impact sur les garanties en place et sollicite la compagnie pour l'émission d'un avenant. L'ajout d'un véhicule à une flotte est généralement effectif sous 24 à 48 heures ouvrées, une carte verte provisoire pouvant être émise le temps de l'avenant définitif. Pour un changement de local, il est recommandé de prévenir le cabinet au moins 15 jours avant le déménagement afin d'assurer la continuité de couverture.

Un avenant peut entraîner un ajustement de cotisation, à la hausse comme à la baisse ; le cabinet transmet la proposition chiffrée de la compagnie avant toute validation par le client.`,
  },
  {
    title: "Échéance, renouvellement et résiliation",
    text: `Renouvellement et résiliation des contrats professionnels.

Les contrats se renouvellent par tacite reconduction à leur date d'échéance annuelle. L'avis d'échéance est adressé par la compagnie avant l'échéance ; le cabinet le relaie et reste disponible pour réétudier les garanties ou remettre le contrat en concurrence à cette occasion.

Résiliation à l'échéance : le préavis contractuel usuel pour un contrat professionnel est de deux mois avant la date d'échéance (se référer aux conditions générales du contrat concerné, certains contrats prévoyant un mois). La demande doit être formalisée par écrit ; le cabinet peut s'en charger sur instruction du client.

Une révision tarifaire à l'échéance peut, selon les conditions générales, ouvrir un droit de résiliation spécifique dans un délai limité après réception de l'avis. En cas d'augmentation jugée importante, le réflexe recommandé est de contacter le cabinet dès réception de l'avis pour étudier les options : négociation avec la compagnie, ajustement des garanties, ou remise en concurrence.`,
  },
  {
    title: "Garanties responsabilité civile professionnelle",
    text: `Responsabilité civile professionnelle (RC Pro) — repères généraux.

La RC Pro couvre les dommages causés aux tiers dans le cadre de l'activité professionnelle : dommages corporels, matériels et immatériels consécutifs, selon les plafonds et franchises prévus au contrat. Certaines professions réglementées ont une obligation légale d'assurance.

Le niveau de garantie pertinent dépend de l'activité, du chiffre d'affaires, des exigences contractuelles des clients et donneurs d'ordre. Les contrats prévoient des plafonds par sinistre et par année d'assurance ; les exigences d'un donneur d'ordre (montants minimaux à attester) doivent être transmises au cabinet pour vérification de conformité du contrat en place.

La RC Pro ne couvre pas, en général : les dommages aux biens propres de l'entreprise (relevant de la multirisque), la faute intentionnelle, ni les pénalités contractuelles. Chaque situation doit être étudiée au regard des conditions générales du contrat concerné — le cabinet réalise cette analyse sur demande.`,
  },
  {
    title: "Multirisque professionnelle et locaux",
    text: `Multirisque professionnelle — repères généraux.

La multirisque professionnelle protège les locaux et leur contenu : incendie, dégât des eaux, vol et vandalisme, bris de glace, événements climatiques, et généralement une garantie perte d'exploitation en option ou incluse selon les formules.

Points d'attention usuels : la surface et l'adresse déclarées doivent être à jour (tout déménagement ou extension doit être signalé), le capital contenu (matériel, stock) doit refléter la valeur réelle pour éviter une règle proportionnelle en cas de sinistre, et les mesures de protection exigées (alarme, fermetures) conditionnent la garantie vol.

Pour l'ouverture d'un nouveau local, le cabinet a besoin : de l'adresse et la surface, de la nature de l'activité exercée, de la valeur du contenu, et de la qualité d'occupation (propriétaire ou locataire). Un devis peut généralement être proposé sous quelques jours ouvrés une fois ces éléments réunis.`,
  },
  {
    title: "Assurance cyber — repères",
    text: `Assurance cyber-risques — repères généraux.

Les contrats cyber couvrent classiquement : les frais de gestion d'incident (investigation, restauration des systèmes et des données), les pertes d'exploitation consécutives à une attaque, la responsabilité civile en cas de fuite de données affectant des tiers, et souvent un volet assistance (cellule de crise, notification aux personnes concernées).

Le dimensionnement du plafond dépend du chiffre d'affaires, du volume et de la sensibilité des données traitées, et des exigences contractuelles des clients. Les assureurs conditionnent la souscription à des prérequis de sécurité (sauvegardes, authentification multifacteur, mises à jour) déclarés au questionnaire technique.

Pour une étude cyber, le cabinet a besoin du questionnaire technique complété ; la proposition est ensuite obtenue auprès des compagnies partenaires. Le cabinet ne recommande pas de plafond chiffré sans cette étude préalable.`,
  },
  {
    title: "Santé collective et prévoyance — cadre général",
    text: `Santé collective et prévoyance d'entreprise — cadre général de gestion.

Le cabinet accompagne les entreprises sur leurs régimes collectifs : complémentaire santé obligatoire des salariés et prévoyance (incapacité, invalidité, décès). Les questions de niveau de remboursement précises se traitent au regard du tableau de garanties du contrat en place, que le gestionnaire peut réadresser sur demande.

Gestion courante : affiliation et radiation des salariés (à signaler dès l'entrée ou la sortie des effectifs), portabilité des garanties pour les anciens salariés dans les conditions légales, mise à jour des dispenses d'adhésion.

Important — protection des données : le cabinet ne demande et ne conserve jamais d'informations médicales par email. Toute situation impliquant des éléments de santé (arrêt de travail, dossier de prévoyance) est orientée directement vers la compagnie via ses circuits dédiés ou traitée par téléphone avec le gestionnaire habilité.`,
  },
  {
    title: "Traitement des réclamations",
    text: `Traitement des réclamations — engagement de service.

Toute réclamation (désaccord sur la gestion d'un dossier, délai anormal, contestation d'une position de la compagnie) peut être adressée par écrit au cabinet. Le cabinet en accuse réception sous 10 jours ouvrés au plus et apporte une réponse dans un délai maximal de deux mois, conformément aux pratiques de la profession.

Le traitement comprend : la relecture du dossier par un responsable distinct du gestionnaire concerné lorsque c'est possible, un point de situation avec la compagnie le cas échéant, et une réponse écrite motivée.

Si le désaccord persiste après la réponse du cabinet, le client peut saisir le service réclamations de la compagnie concernée, puis le médiateur de l'assurance, dont les coordonnées figurent dans les conditions générales du contrat. Le cabinet communique ces coordonnées sur simple demande.`,
  },
];

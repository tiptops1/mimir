// S10 embedding spike fixture: ~50 synthetic French insurance-broker (courtier)
// chunks across 10 topics x 5 facets, plus a labeled eval set (query -> expected
// chunk id) for recall@1 / recall@3 scoring. Synthetic — no real customer data
// (per decisions.md, no real customer exists yet at this phase).

export interface Chunk {
  id: string;
  topic: string;
  text: string;
}

export const CHUNKS: Chunk[] = [
  // T1 — Assurance auto
  { id: "auto-1", topic: "auto", text: "La garantie tous risques couvre les dommages subis par le véhicule assuré, qu'il soit responsable ou non de l'accident, y compris en l'absence de tiers identifié. Elle inclut généralement l'incendie, le vol et le bris de glace en complément." },
  { id: "auto-2", topic: "auto", text: "La franchise en cas de sinistre auto est le montant restant à la charge de l'assuré après indemnisation. Elle varie selon les garanties souscrites : souvent entre 150€ et 500€ pour le bris de glace, davantage pour les dommages tous accidents." },
  { id: "auto-3", topic: "auto", text: "Le coefficient bonus-malus évolue chaque année selon la sinistralité responsable : -5% par an sans sinistre responsable (bonus), +25% par sinistre responsable (malus). Le coefficient plancher est de 0,50 après 13 ans sans accident responsable." },
  { id: "auto-4", topic: "auto", text: "L'assurance au tiers correspond aux garanties minimales légales obligatoires en France : la responsabilité civile, qui couvre les dommages causés à des tiers, personnes ou biens, mais ne couvre pas les dommages au véhicule de l'assuré lui-même." },
  { id: "auto-5", topic: "auto", text: "Le véhicule de remplacement est accordé sous condition de garantie souscrite, généralement pendant la durée de réparation ou dans un délai plafonné (5 à 30 jours selon le contrat), et parfois uniquement si le sinistre est responsable ou couvert tous risques." },

  // T2 — Assurance habitation
  { id: "habitation-1", topic: "habitation", text: "En cas de dégât des eaux, l'assuré doit déclarer le sinistre à son assureur dans les 5 jours ouvrés, joindre des photos des dégâts et, si un tiers est impliqué (voisin, copropriété), remplir un constat amiable dégât des eaux." },
  { id: "habitation-2", topic: "habitation", text: "La garantie incendie exclut généralement les dommages causés par un défaut d'entretien manifeste, une négligence grave de l'assuré, ou un feu volontairement allumé par l'assuré lui-même — ces cas relèvent d'une déchéance de garantie." },
  { id: "habitation-3", topic: "habitation", text: "La garantie vol et cambriolage exige souvent des conditions de sécurisation minimales : porte blindée ou serrure trois points, et parfois un système d'alarme pour les biens de valeur élevée, faute de quoi l'indemnisation peut être réduite." },
  { id: "habitation-4", topic: "habitation", text: "La responsabilité civile locative couvre les dommages que le locataire pourrait causer au logement loué ou à l'immeuble (incendie, dégât des eaux, explosion) et engage sa responsabilité vis-à-vis du propriétaire et des voisins." },
  { id: "habitation-5", topic: "habitation", text: "L'indemnisation du mobilier peut se faire en valeur à neuf (remboursement du prix d'achat d'un bien équivalent neuf) ou en valeur vétusté (prix neuf diminué d'un coefficient de dépréciation lié à l'âge du bien) selon l'option souscrite." },

  // T3 — Santé / mutuelle
  { id: "sante-1", topic: "sante", text: "Le remboursement optique est généralement plafonné annuellement ou tous les deux ans selon les contrats, avec des montants distincts pour les montures, les verres simples et les verres complexes, en complément du remboursement de la Sécurité sociale." },
  { id: "sante-2", topic: "sante", text: "Le délai de carence est la période suivant la souscription pendant laquelle certaines garanties ne sont pas encore actives : souvent 3 mois pour l'hospitalisation, jusqu'à 9 mois pour la maternité, généralement nul pour les soins courants." },
  { id: "sante-3", topic: "sante", text: "Le tiers payant permet à l'assuré de ne pas avancer les frais de santé : la mutuelle et la Sécurité sociale règlent directement le professionnel de santé ou la pharmacie, sur présentation de la carte de tiers payant." },
  { id: "sante-4", topic: "sante", text: "Le forfait journalier hospitalier, facturé par les établissements de santé pour l'hébergement, est pris en charge intégralement par la plupart des contrats de complémentaire santé, sans limitation de durée pour les contrats responsables." },
  { id: "sante-5", topic: "sante", text: "La prise en charge des médecines douces (ostéopathie, acupuncture, chiropraxie) se fait généralement sous forme de forfait annuel, plafonné en nombre de séances et en montant par séance, variable selon le niveau de garantie souscrit." },

  // T4 — RC Pro
  { id: "rcpro-1", topic: "rcpro", text: "La RC Pro du courtier en assurance est une obligation légale imposée par le registre ORIAS : tout courtier doit justifier d'une assurance responsabilité civile professionnelle en cours de validité pour exercer, sous peine de radiation." },
  { id: "rcpro-2", topic: "rcpro", text: "Le plafond de garantie recommandé pour une RC Pro varie selon l'activité et le chiffre d'affaires : pour un courtier en assurance, les plafonds usuels se situent entre 1,5 et 3 millions d'euros par sinistre." },
  { id: "rcpro-3", topic: "rcpro", text: "La faute professionnelle couverte par la RC Pro inclut le manquement au devoir de conseil, l'erreur dans la rédaction d'un contrat, l'omission d'information substantielle au client, ou le retard fautif dans le traitement d'un dossier." },
  { id: "rcpro-4", topic: "rcpro", text: "La garantie défense pénale et recours, souvent annexée à la RC Pro, prend en charge les frais d'avocat en cas de poursuite pénale liée à l'activité professionnelle, ainsi que les démarches pour obtenir réparation d'un préjudice subi." },
  { id: "rcpro-5", topic: "rcpro", text: "Le recours à un sous-traitant dans le cadre de l'activité de courtage nécessite généralement une extension de garantie spécifique à la RC Pro, faute de quoi les dommages causés par le sous-traitant peuvent ne pas être couverts." },

  // T5 — Assurance vie / épargne
  { id: "vie-1", topic: "vie", text: "Le fonds euros garantit le capital investi et offre un rendement annuel généralement modeste mais sécurisé, tandis que les unités de compte sont investies sur les marchés financiers, avec un potentiel de gain supérieur mais sans garantie en capital." },
  { id: "vie-2", topic: "vie", text: "La clause bénéficiaire d'une assurance vie désigne la ou les personnes qui recevront le capital au décès de l'assuré ; il est recommandé de la rédiger précisément et de la mettre à jour à chaque changement de situation familiale." },
  { id: "vie-3", topic: "vie", text: "Après 8 ans de détention, l'assurance vie bénéficie d'un abattement fiscal annuel sur les gains rachetés (4 600€ pour une personne seule, 9 200€ pour un couple), au-delà duquel un prélèvement forfaitaire réduit s'applique." },
  { id: "vie-4", topic: "vie", text: "Le rachat partiel permet de retirer une partie du capital d'un contrat d'assurance vie sans le clôturer ; il reste possible à tout moment, avec un délai de traitement généralement de quelques jours à quelques semaines selon l'assureur." },
  { id: "vie-5", topic: "vie", text: "Les versements programmés permettent d'alimenter automatiquement un contrat d'assurance vie à intervalle régulier (mensuel, trimestriel), un montant minimum étant souvent fixé par l'assureur, avec possibilité de modification ou de suspension à tout moment." },

  // T6 — Procédure sinistre
  { id: "sinistre-1", topic: "sinistre", text: "Le délai légal de déclaration d'un sinistre est de 5 jours ouvrés à compter de sa survenance ou de sa découverte, réduit à 2 jours ouvrés pour un vol ; passé ce délai, l'assureur peut opposer une déchéance de garantie." },
  { id: "sinistre-2", topic: "sinistre", text: "Le constat amiable doit être rempli et signé par les deux conducteurs impliqués dans l'accident sur place, en décrivant précisément les circonstances et en réalisant un croquis ; chacun en conserve un exemplaire pour l'envoyer à son assureur." },
  { id: "sinistre-3", topic: "sinistre", text: "L'expertise consiste en la visite d'un expert mandaté par l'assureur pour évaluer les dommages, chiffrer le coût des réparations ou la valeur du bien sinistré, et déterminer les responsabilités techniques ; l'assuré peut se faire assister par un expert d'assuré." },
  { id: "sinistre-4", topic: "sinistre", text: "Les pièces justificatives usuellement demandées lors d'un sinistre comprennent : photos des dommages, factures d'achat des biens endommagés, devis de réparation, dépôt de plainte en cas de vol, et le constat amiable le cas échéant." },
  { id: "sinistre-5", topic: "sinistre", text: "Après accord sur le montant de l'indemnisation, l'assureur dispose d'un délai contractuel, généralement de 10 à 30 jours, pour verser les fonds à l'assuré, sauf complément d'expertise ou contestation en cours." },

  // T7 — Résiliation / Loi Hamon
  { id: "resiliation-1", topic: "resiliation", text: "La loi Hamon permet de résilier un contrat d'assurance auto, habitation ou affinitaire à tout moment après un an de souscription, sans frais ni pénalité, le nouvel assureur se chargeant des démarches de résiliation auprès de l'ancien." },
  { id: "resiliation-2", topic: "resiliation", text: "En dehors du cadre de la loi Hamon, la résiliation classique à échéance doit être notifiée avec un préavis de 2 mois avant la date anniversaire du contrat, par lettre recommandée ou tout autre support durable prévu au contrat." },
  { id: "resiliation-3", topic: "resiliation", text: "En cas d'augmentation de tarif non justifiée par une évolution du risque, certains contrats prévoient un droit de résiliation spécifique pour le souscripteur dans un délai fixé après la notification de la hausse, en dehors de l'échéance annuelle." },
  { id: "resiliation-4", topic: "resiliation", text: "Le non-paiement d'une cotisation entraîne une mise en demeure, puis une suspension des garanties 30 jours après son envoi si la cotisation reste impayée, et une résiliation possible du contrat 10 jours après le début de la suspension." },
  { id: "resiliation-5", topic: "resiliation", text: "Certains changements de situation (déménagement, changement de profession, régime matrimonial, cessation d'activité) ouvrent droit à une résiliation anticipée du contrat, sous réserve que le changement modifie substantiellement le risque assuré." },

  // T8 — Cotisations et paiement
  { id: "cotisation-1", topic: "cotisation", text: "Le prélèvement mensuel de la cotisation répartit la charge sur l'année mais peut inclure des frais de fractionnement, généralement de 2 à 5% par rapport au paiement annuel unique, qui reste souvent l'option la moins coûteuse au total." },
  { id: "cotisation-2", topic: "cotisation", text: "En cas d'impayé, l'assureur envoie une relance puis une mise en demeure ; l'assuré dispose généralement d'un délai de régularisation de 30 jours après cette mise en demeure avant que les garanties ne soient suspendues." },
  { id: "cotisation-3", topic: "cotisation", text: "La révision tarifaire annuelle des cotisations s'appuie souvent sur un indice de référence publié par la Fédération Française de l'Assurance (FFA), reflétant l'évolution du coût moyen des sinistres et des réparations sur l'année écoulée." },
  { id: "cotisation-4", topic: "cotisation", text: "Les moyens de paiement acceptés pour le règlement des cotisations incluent généralement le prélèvement automatique SEPA, la carte bancaire en ligne, et le virement, le prélèvement restant le mode le plus utilisé pour les contrats à échéances régulières." },
  { id: "cotisation-5", topic: "cotisation", text: "Un échéancier personnalisé peut être accordé à un assuré rencontrant des difficultés ponctuelles de paiement, sous réserve d'accord de l'assureur, afin d'étaler le règlement d'une cotisation en retard sans déclencher immédiatement une procédure de résiliation." },

  // T9 — Garanties complémentaires
  { id: "complementaire-1", topic: "complementaire", text: "La garantie bris de glace couvre le pare-brise, les vitres latérales et le toit ouvrant du véhicule, avec une franchise réduite par rapport aux autres garanties, voire nulle dans certains contrats haut de gamme." },
  { id: "complementaire-2", topic: "complementaire", text: "L'assistance 0 km permet un dépannage sur place même à proximité immédiate du domicile de l'assuré, contrairement aux formules d'assistance classiques qui n'interviennent qu'au-delà d'un certain nombre de kilomètres du domicile." },
  { id: "complementaire-3", topic: "complementaire", text: "La protection juridique couvre les frais de défense ou de recours de l'assuré dans un litige relevant des domaines prévus au contrat (consommation, travail, voisinage, immobilier), incluant honoraires d'avocat et frais de procédure sous plafond." },
  { id: "complementaire-4", topic: "complementaire", text: "La garantie valeur à neuf pendant 24 mois indemnise un véhicule neuf sinistré ou volé sur la base de son prix d'achat initial, sans application de vétusté, pendant les deux premières années suivant sa première mise en circulation." },
  { id: "complementaire-5", topic: "complementaire", text: "La garantie individuelle accident verse un capital à l'assuré ou à ses proches en cas d'invalidité permanente ou de décès accidentel, en complément des prestations de la Sécurité sociale, selon un barème d'invalidité prévu au contrat." },

  // T10 — Relation client / réclamation
  { id: "relation-1", topic: "relation", text: "La procédure de réclamation d'un client mécontent passe d'abord par le service client de l'assureur ou du courtier, puis, en l'absence de réponse satisfaisante sous 2 mois, par la saisine du médiateur de l'assurance, gratuite et indépendante." },
  { id: "relation-2", topic: "relation", text: "Le devoir de conseil du courtier l'oblige légalement à analyser les besoins du client, à lui proposer des garanties adaptées à sa situation, et à documenter par écrit les raisons de ses recommandations avant la souscription." },
  { id: "relation-3", topic: "relation", text: "Le document d'information sur le produit d'assurance (DIP) doit être remis obligatoirement au client avant la souscription de tout contrat, résumant de façon standardisée les garanties, exclusions et obligations principales du contrat." },
  { id: "relation-4", topic: "relation", text: "L'enquête de satisfaction client, menée annuellement par de nombreux courtiers, permet de mesurer la qualité perçue du conseil, la clarté des explications fournies et la rapidité de traitement des sinistres et des demandes." },
  { id: "relation-5", topic: "relation", text: "Le portail client en ligne permet généralement de consulter ses contrats et attestations, de déclarer un sinistre, de suivre son remboursement, et d'échanger des documents avec son courtier sans passer par un appel téléphonique." },
];

export interface EvalQuery {
  query: string;
  expectedId: string;
}

export const EVAL_QUERIES: EvalQuery[] = [
  { query: "Quelle est la différence entre l'assurance tous risques et l'assurance au tiers ?", expectedId: "auto-1" },
  { query: "Comment fonctionne le malus après un accident responsable ?", expectedId: "auto-3" },
  { query: "Que faire si j'ai un dégât des eaux chez moi ?", expectedId: "habitation-1" },
  { query: "Mon assurance habitation peut-elle refuser de me couvrir en cas d'incendie ?", expectedId: "habitation-2" },
  { query: "Quel est le plafond de remboursement pour mes lunettes ?", expectedId: "sante-1" },
  { query: "Combien de temps dois-je attendre avant que ma mutuelle couvre une hospitalisation ?", expectedId: "sante-2" },
  { query: "Un courtier est-il obligé d'avoir une assurance responsabilité civile professionnelle ?", expectedId: "rcpro-1" },
  { query: "Qu'est-ce qui est considéré comme une faute professionnelle pour un courtier ?", expectedId: "rcpro-3" },
  { query: "Quelle est la différence entre fonds euros et unités de compte ?", expectedId: "vie-1" },
  { query: "Comment est imposé le rachat d'une assurance vie après 8 ans ?", expectedId: "vie-3" },
  { query: "Combien de temps ai-je pour déclarer un sinistre à mon assureur ?", expectedId: "sinistre-1" },
  { query: "Qui doit remplir le constat amiable après un accident de voiture ?", expectedId: "sinistre-2" },
  { query: "Puis-je résilier mon assurance auto à tout moment après un an ?", expectedId: "resiliation-1" },
  { query: "Que se passe-t-il si je ne paie pas ma cotisation d'assurance ?", expectedId: "resiliation-4" },
  { query: "Est-ce que payer en mensualités coûte plus cher que payer en une fois ?", expectedId: "cotisation-1" },
  { query: "Sur quel indice se base la hausse annuelle des cotisations d'assurance ?", expectedId: "cotisation-3" },
  { query: "Est-ce que le pare-brise est couvert avec une franchise réduite ?", expectedId: "complementaire-1" },
  { query: "Qu'est-ce que la garantie valeur à neuf pour un véhicule ?", expectedId: "complementaire-4" },
  { query: "Comment un client peut-il faire une réclamation contre son assureur ?", expectedId: "relation-1" },
  { query: "Quel document dois-je recevoir avant de signer un contrat d'assurance ?", expectedId: "relation-3" },
];

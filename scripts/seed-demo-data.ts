import "dotenv/config";
import { PrismaClient as ControlClient } from "../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../src/lib/crypto";
import { seedTenantConfig } from "../src/lib/default-config";

// S6: give a tenant (default crm_demo) realistic French insurance-broker
// (courtier) prospect data, so it stops being the empty shell tenant:provision
// leaves behind. Idempotent — Company is upserted by siret (stable synthetic
// SIRETs below), and every child collection is deleted+recreated per company
// from the fixture, so a rerun always converges to the same end state.
//
//   npx tsx scripts/seed-demo-data.ts [slug=crm_demo]

const STAGE_PRODUCT: Record<string, string> = {
  A_QUALIFIER: "Santé",
  A_CONTACTER: "Santé",
  CONTACTE: "Prévoyance",
  RDV_OBTENU: "IARD",
  DEMO_REALISEE: "IARD",
  PROPOSITION_ENVOYEE: "RC Pro",
  GAGNE: "Santé",
  PERDU: "Prévoyance",
};

interface CompanyFixture {
  siret: string;
  siren: string;
  nomSociete: string;
  enseigne: string;
  codeNaf: string;
  libelleNaf: string;
  ville: string;
  codePostal: string;
  chiffreAffaires: number;
  trancheEffectifs: string;
  stage: string;
  priorite: "A" | "B" | "C";
  potentiel: "FAIBLE" | "MOYEN" | "FORT";
  icpScore: number;
  canalPrefere: "PHONE" | "EMAIL" | "LINKEDIN";
  specialties: Partial<{
    specialiteSante: boolean;
    specialitePrevoyance: boolean;
    specialiteIard: boolean;
    specialiteAuto: boolean;
    specialiteRcPro: boolean;
    specialiteEntreprises: boolean;
    specialiteCollectives: boolean;
    specialiteParticuliers: boolean;
  }>;
  contact: { prenom: string; nom: string; fonction: string };
}

// Funnel-shaped: heavy at the top, thin at GAGNE/PERDU — 20 companies total.
const COMPANIES: CompanyFixture[] = [
  { siret: "80234567800011", siren: "802345678", nomSociete: "Cabinet Durand Assurances", enseigne: "Durand Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Lyon", codePostal: "69003", chiffreAffaires: 1_450_000, trancheEffectifs: "10 à 19 salariés", stage: "A_QUALIFIER", priorite: "B", potentiel: "MOYEN", icpScore: 54, canalPrefere: "EMAIL", specialties: { specialiteSante: true, specialiteParticuliers: true }, contact: { prenom: "Marc", nom: "Durand", fonction: "Gérant" } },
  { siret: "80234567800029", siren: "802345678", nomSociete: "Assurances Lefevre & Fils", enseigne: "Lefevre Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Nantes", codePostal: "44000", chiffreAffaires: 890_000, trancheEffectifs: "6 à 9 salariés", stage: "A_QUALIFIER", priorite: "C", potentiel: "FAIBLE", icpScore: 31, canalPrefere: "PHONE", specialties: { specialiteAuto: true, specialiteParticuliers: true }, contact: { prenom: "Sophie", nom: "Lefevre", fonction: "Associée" } },
  { siret: "81345678900012", siren: "813456789", nomSociete: "Courtage Martin", enseigne: "Martin Courtage", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Toulouse", codePostal: "31000", chiffreAffaires: 2_100_000, trancheEffectifs: "20 à 49 salariés", stage: "A_QUALIFIER", priorite: "A", potentiel: "FORT", icpScore: 78, canalPrefere: "LINKEDIN", specialties: { specialiteEntreprises: true, specialiteRcPro: true }, contact: { prenom: "Julien", nom: "Martin", fonction: "Directeur" } },
  { siret: "81345678900020", siren: "813456789", nomSociete: "AssurConseil Bretagne", enseigne: "AssurConseil", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Rennes", codePostal: "35000", chiffreAffaires: 640_000, trancheEffectifs: "3 à 5 salariés", stage: "A_QUALIFIER", priorite: "C", potentiel: "FAIBLE", icpScore: 22, canalPrefere: "EMAIL", specialties: { specialiteParticuliers: true }, contact: { prenom: "Camille", nom: "Le Gall", fonction: "Gérante" } },
  { siret: "82456789000013", siren: "824567890", nomSociete: "Cabinet Petit Assurances", enseigne: "Petit Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Bordeaux", codePostal: "33000", chiffreAffaires: 1_020_000, trancheEffectifs: "10 à 19 salariés", stage: "A_CONTACTER", priorite: "B", potentiel: "MOYEN", icpScore: 61, canalPrefere: "PHONE", specialties: { specialiteSante: true, specialiteCollectives: true }, contact: { prenom: "Nicolas", nom: "Petit", fonction: "Gérant" } },
  { siret: "82456789000021", siren: "824567890", nomSociete: "Groupe Rousseau Courtage", enseigne: "Rousseau Courtage", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Lille", codePostal: "59000", chiffreAffaires: 3_400_000, trancheEffectifs: "50 à 99 salariés", stage: "A_CONTACTER", priorite: "A", potentiel: "FORT", icpScore: 82, canalPrefere: "LINKEDIN", specialties: { specialiteEntreprises: true, specialiteIard: true, specialiteRcPro: true }, contact: { prenom: "Isabelle", nom: "Rousseau", fonction: "Présidente" } },
  { siret: "83567890100014", siren: "835678901", nomSociete: "Cabinet Simon Prévoyance", enseigne: "Simon Prévoyance", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Strasbourg", codePostal: "67000", chiffreAffaires: 780_000, trancheEffectifs: "6 à 9 salariés", stage: "A_CONTACTER", priorite: "B", potentiel: "MOYEN", icpScore: 57, canalPrefere: "EMAIL", specialties: { specialitePrevoyance: true }, contact: { prenom: "Antoine", nom: "Simon", fonction: "Gérant" } },
  { siret: "83567890100022", siren: "835678901", nomSociete: "Courtage Moreau & Associés", enseigne: "Moreau Courtage", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Marseille", codePostal: "13001", chiffreAffaires: 1_650_000, trancheEffectifs: "10 à 19 salariés", stage: "CONTACTE", priorite: "B", potentiel: "MOYEN", icpScore: 66, canalPrefere: "PHONE", specialties: { specialiteAuto: true, specialiteIard: true }, contact: { prenom: "Céline", nom: "Moreau", fonction: "Directrice" } },
  { siret: "84678901200015", siren: "846789012", nomSociete: "Cabinet Girard Assurances", enseigne: "Girard Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Nice", codePostal: "06000", chiffreAffaires: 1_180_000, trancheEffectifs: "10 à 19 salariés", stage: "CONTACTE", priorite: "A", potentiel: "FORT", icpScore: 74, canalPrefere: "EMAIL", specialties: { specialiteSante: true, specialiteCollectives: true, specialiteEntreprises: true }, contact: { prenom: "Thomas", nom: "Girard", fonction: "Gérant" } },
  { siret: "84678901200023", siren: "846789012", nomSociete: "AssurPro Auvergne", enseigne: "AssurPro", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Clermont-Ferrand", codePostal: "63000", chiffreAffaires: 520_000, trancheEffectifs: "3 à 5 salariés", stage: "CONTACTE", priorite: "C", potentiel: "FAIBLE", icpScore: 28, canalPrefere: "PHONE", specialties: { specialiteParticuliers: true }, contact: { prenom: "Valérie", nom: "Faure", fonction: "Gérante" } },
  { siret: "85789012300016", siren: "857890123", nomSociete: "Cabinet Fontaine Courtage", enseigne: "Fontaine Courtage", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Montpellier", codePostal: "34000", chiffreAffaires: 940_000, trancheEffectifs: "6 à 9 salariés", stage: "RDV_OBTENU", priorite: "A", potentiel: "FORT", icpScore: 79, canalPrefere: "LINKEDIN", specialties: { specialiteIard: true, specialiteAuto: true }, contact: { prenom: "Pierre", nom: "Fontaine", fonction: "Gérant" } },
  { siret: "85789012300024", siren: "857890123", nomSociete: "Groupe Bernard Assurances", enseigne: "Bernard Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Rennes", codePostal: "35000", chiffreAffaires: 2_750_000, trancheEffectifs: "20 à 49 salariés", stage: "RDV_OBTENU", priorite: "A", potentiel: "FORT", icpScore: 85, canalPrefere: "EMAIL", specialties: { specialiteEntreprises: true, specialiteRcPro: true, specialiteCollectives: true }, contact: { prenom: "Sandrine", nom: "Bernard", fonction: "Directrice générale" } },
  { siret: "86890123400017", siren: "868901234", nomSociete: "Cabinet Robert Prévoyance", enseigne: "Robert Prévoyance", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Dijon", codePostal: "21000", chiffreAffaires: 680_000, trancheEffectifs: "3 à 5 salariés", stage: "RDV_OBTENU", priorite: "B", potentiel: "MOYEN", icpScore: 58, canalPrefere: "PHONE", specialties: { specialitePrevoyance: true, specialiteSante: true }, contact: { prenom: "Olivier", nom: "Robert", fonction: "Gérant" } },
  { siret: "87901234500018", siren: "879012345", nomSociete: "Courtage Michel & Cie", enseigne: "Michel Courtage", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Reims", codePostal: "51100", chiffreAffaires: 1_320_000, trancheEffectifs: "10 à 19 salariés", stage: "DEMO_REALISEE", priorite: "A", potentiel: "FORT", icpScore: 81, canalPrefere: "EMAIL", specialties: { specialiteIard: true, specialiteEntreprises: true }, contact: { prenom: "Émilie", nom: "Michel", fonction: "Gérante" } },
  { siret: "87901234500026", siren: "879012345", nomSociete: "Cabinet Garnier Assurances", enseigne: "Garnier Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Angers", codePostal: "49000", chiffreAffaires: 970_000, trancheEffectifs: "6 à 9 salariés", stage: "DEMO_REALISEE", priorite: "B", potentiel: "MOYEN", icpScore: 63, canalPrefere: "PHONE", specialties: { specialiteSante: true, specialiteParticuliers: true }, contact: { prenom: "David", nom: "Garnier", fonction: "Gérant" } },
  { siret: "88012345600019", siren: "880123456", nomSociete: "Groupe Andre Courtage", enseigne: "Andre Courtage", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Tours", codePostal: "37000", chiffreAffaires: 1_890_000, trancheEffectifs: "20 à 49 salariés", stage: "PROPOSITION_ENVOYEE", priorite: "A", potentiel: "FORT", icpScore: 88, canalPrefere: "LINKEDIN", specialties: { specialiteRcPro: true, specialiteEntreprises: true }, contact: { prenom: "Laurent", nom: "André", fonction: "Directeur associé" } },
  { siret: "88012345600027", siren: "880123456", nomSociete: "Cabinet Chevalier Assurances", enseigne: "Chevalier Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Grenoble", codePostal: "38000", chiffreAffaires: 1_050_000, trancheEffectifs: "10 à 19 salariés", stage: "PROPOSITION_ENVOYEE", priorite: "B", potentiel: "MOYEN", icpScore: 69, canalPrefere: "EMAIL", specialties: { specialiteIard: true, specialiteAuto: true }, contact: { prenom: "Nathalie", nom: "Chevalier", fonction: "Gérante" } },
  { siret: "89123456700010", siren: "891234567", nomSociete: "Cabinet Lemoine & Associés", enseigne: "Lemoine Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Orléans", codePostal: "45000", chiffreAffaires: 2_300_000, trancheEffectifs: "20 à 49 salariés", stage: "GAGNE", priorite: "A", potentiel: "FORT", icpScore: 91, canalPrefere: "EMAIL", specialties: { specialiteEntreprises: true, specialiteSante: true, specialiteCollectives: true }, contact: { prenom: "François", nom: "Lemoine", fonction: "Gérant" } },
  { siret: "89123456700028", siren: "891234567", nomSociete: "Assurances Dubois Frères", enseigne: "Dubois Assurances", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Le Mans", codePostal: "72000", chiffreAffaires: 1_540_000, trancheEffectifs: "10 à 19 salariés", stage: "GAGNE", priorite: "A", potentiel: "FORT", icpScore: 86, canalPrefere: "PHONE", specialties: { specialiteIard: true, specialiteRcPro: true }, contact: { prenom: "Christine", nom: "Dubois", fonction: "Gérante" } },
  { siret: "90234567800011", siren: "902345678", nomSociete: "Cabinet Perrin Courtage", enseigne: "Perrin Courtage", codeNaf: "66.22Z", libelleNaf: "Activités des agents et courtiers d'assurances", ville: "Besançon", codePostal: "25000", chiffreAffaires: 610_000, trancheEffectifs: "3 à 5 salariés", stage: "PERDU", priorite: "C", potentiel: "FAIBLE", icpScore: 19, canalPrefere: "PHONE", specialties: { specialiteParticuliers: true }, contact: { prenom: "Sébastien", nom: "Perrin", fonction: "Gérant" } },
];

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Deterministic date `daysAgo` days before now (stable across reruns, unlike `new Date()` jitter). */
function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(9, 0, 0, 0);
  return d;
}

async function main() {
  const slug = process.argv[2] ?? "crm_demo";
  const control = new ControlClient();
  const tenant = await control.tenant.findUnique({
    where: { slug },
    select: { connectionString: true },
  });
  if (!tenant) throw new Error(`Unknown tenant: ${slug}`);

  const prisma = new TenantClient({ datasourceUrl: decrypt(tenant.connectionString) });

  console.log(`Seeding demo data for "${slug}"…`);
  await seedTenantConfig(prisma);

  let contactCount = 0;
  let dealCount = 0;
  let activityCount = 0;
  let taskCount = 0;
  let stageChangeCount = 0;
  const wonCompanyIds: string[] = [];

  for (const [i, fixture] of COMPANIES.entries()) {
    const company = await prisma.company.upsert({
      where: { siret: fixture.siret },
      update: {
        siren: fixture.siren,
        nomSociete: fixture.nomSociete,
        enseigne: fixture.enseigne,
        categorieEntreprise: "PME",
        formeJuridique: "SARL",
        codeNaf: fixture.codeNaf,
        libelleNaf: fixture.libelleNaf,
        trancheEffectifs: fixture.trancheEffectifs,
        ville: fixture.ville,
        codePostal: fixture.codePostal,
        siteWeb: `https://www.${fixture.enseigne.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.fr`,
        emailGenerique: `contact@${fixture.enseigne.toLowerCase().replace(/[^a-z0-9]+/g, "")}.fr`,
        telephoneStandard: `0${(2 + (i % 5))} ${pad(10 + i)} ${pad(20 + i)} ${pad(30 + i)} ${pad(40 + i)}`,
        chiffreAffaires: fixture.chiffreAffaires,
        canalPrefere: fixture.canalPrefere,
        stage: fixture.stage,
        priorite: fixture.priorite,
        potentiel: fixture.potentiel,
        icpScore: fixture.icpScore,
        nbCollaborateursEstime: Math.round(fixture.chiffreAffaires / 90_000),
        niveauDigitalisation: fixture.icpScore > 70 ? "Élevé" : fixture.icpScore > 40 ? "Moyen" : "Faible",
        datePremierContact: daysAgo(60 - i),
        dernierContact: daysAgo(5 + (i % 10)),
        demoRealisee: ["DEMO_REALISEE", "PROPOSITION_ENVOYEE", "GAGNE"].includes(fixture.stage),
        propositionEnvoyee: ["PROPOSITION_ENVOYEE", "GAGNE"].includes(fixture.stage),
        ...fixture.specialties,
      },
      create: {
        siret: fixture.siret,
        siren: fixture.siren,
        nomSociete: fixture.nomSociete,
        enseigne: fixture.enseigne,
        categorieEntreprise: "PME",
        formeJuridique: "SARL",
        dateCreation: daysAgo(365 * (5 + (i % 15))),
        codeNaf: fixture.codeNaf,
        libelleNaf: fixture.libelleNaf,
        trancheEffectifs: fixture.trancheEffectifs,
        ville: fixture.ville,
        codePostal: fixture.codePostal,
        siteWeb: `https://www.${fixture.enseigne.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.fr`,
        emailGenerique: `contact@${fixture.enseigne.toLowerCase().replace(/[^a-z0-9]+/g, "")}.fr`,
        telephoneStandard: `0${(2 + (i % 5))} ${pad(10 + i)} ${pad(20 + i)} ${pad(30 + i)} ${pad(40 + i)}`,
        chiffreAffaires: fixture.chiffreAffaires,
        canalPrefere: fixture.canalPrefere,
        stage: fixture.stage,
        priorite: fixture.priorite,
        potentiel: fixture.potentiel,
        icpScore: fixture.icpScore,
        nbCollaborateursEstime: Math.round(fixture.chiffreAffaires / 90_000),
        niveauDigitalisation: fixture.icpScore > 70 ? "Élevé" : fixture.icpScore > 40 ? "Moyen" : "Faible",
        datePremierContact: daysAgo(60 - i),
        dernierContact: daysAgo(5 + (i % 10)),
        demoRealisee: ["DEMO_REALISEE", "PROPOSITION_ENVOYEE", "GAGNE"].includes(fixture.stage),
        propositionEnvoyee: ["PROPOSITION_ENVOYEE", "GAGNE"].includes(fixture.stage),
        ...fixture.specialties,
      },
    });

    if (fixture.stage === "GAGNE") wonCompanyIds.push(company.id);

    // Deterministic children: wipe and recreate so reruns converge exactly.
    await prisma.stageChange.deleteMany({ where: { companyId: company.id } });
    await prisma.task.deleteMany({ where: { companyId: company.id } });
    await prisma.activity.deleteMany({ where: { companyId: company.id } });
    await prisma.deal.deleteMany({ where: { companyId: company.id } });
    await prisma.contact.deleteMany({ where: { companyId: company.id } });

    await prisma.contact.create({
      data: {
        prenom: fixture.contact.prenom,
        nom: fixture.contact.nom,
        fonction: fixture.contact.fonction,
        email: `${fixture.contact.prenom.toLowerCase()}.${fixture.contact.nom.toLowerCase().replace(/[^a-z]/g, "")}@${fixture.enseigne.toLowerCase().replace(/[^a-z0-9]+/g, "")}.fr`,
        telephone: `06 ${pad(10 + i)} ${pad(20 + i)} ${pad(30 + i)} ${pad(40 + i)}`,
        linkedinUrl: `https://www.linkedin.com/in/${fixture.contact.prenom.toLowerCase()}-${fixture.contact.nom.toLowerCase().replace(/[^a-z]/g, "")}`,
        isDecisionMaker: true,
        consent: "OPT_IN",
        consentAt: daysAgo(60 - i),
        companyId: company.id,
      },
    });
    contactCount++;

    const product = STAGE_PRODUCT[fixture.stage] ?? "Santé";
    const isWon = fixture.stage === "GAGNE";
    const isLost = fixture.stage === "PERDU";
    await prisma.deal.create({
      data: {
        companyId: company.id,
        title: `${product} — ${fixture.enseigne}`,
        stage: fixture.stage,
        product,
        amount: Math.round(fixture.chiffreAffaires * 0.03),
        status: isWon ? "WON" : isLost ? "LOST" : "OPEN",
        isPrimary: true,
        closeDate: isWon || isLost ? daysAgo(3 + (i % 5)) : null,
      },
    });
    dealCount++;

    // A few companies carry a second, historical deal (re-prospected on renewal).
    if (i % 4 === 0) {
      await prisma.deal.create({
        data: {
          companyId: company.id,
          title: `IARD (renouvellement) — ${fixture.enseigne}`,
          stage: "GAGNE",
          product: "IARD",
          amount: Math.round(fixture.chiffreAffaires * 0.015),
          status: "WON",
          isPrimary: false,
          closeDate: daysAgo(400 + i),
        },
      });
      dealCount++;
    }

    const activities: Array<{
      type: string;
      note: string;
      body?: string;
      daysAgoOffset: number;
      withInsight?: boolean;
      sentiment?: string;
      nextStep?: string;
    }> = [
      { type: "EMAIL", note: "Premier email de prospection envoyé.", daysAgoOffset: 55 - i },
      { type: "CALL", note: "Appel de découverte — présentation de l'offre.", daysAgoOffset: 40 - i },
    ];
    if (["RDV_OBTENU", "DEMO_REALISEE", "PROPOSITION_ENVOYEE", "GAGNE", "PERDU"].includes(fixture.stage)) {
      activities.push({
        type: "MEETING",
        note: "RDV découverte réalisé.",
        body: `Réunion de découverte avec ${fixture.contact.prenom} ${fixture.contact.nom} (${fixture.contact.fonction}). Le cabinet gère un portefeuille ${product.toLowerCase()} et cherche à digitaliser son suivi commercial. Intérêt confirmé pour le pipeline et le scoring des prospects.`,
        daysAgoOffset: 20 - (i % 10),
        withInsight: true,
        sentiment: isLost ? "NEGATIF" : "POSITIF",
        nextStep: isLost ? "Clôturer le dossier" : "Envoyer une proposition chiffrée",
      });
    }
    if (["PROPOSITION_ENVOYEE", "GAGNE"].includes(fixture.stage)) {
      activities.push({
        type: "EMAIL",
        note: "Proposition commerciale envoyée.",
        daysAgoOffset: 8 - (i % 5 > 4 ? 4 : i % 5),
        withInsight: true,
        sentiment: "POSITIF",
        nextStep: isWon ? "Signer le contrat" : "Relancer sous 5 jours",
      });
    }

    for (const a of activities) {
      await prisma.activity.create({
        data: {
          companyId: company.id,
          type: a.type,
          note: a.note,
          body: a.body,
          date: daysAgo(Math.max(a.daysAgoOffset, 0)),
          ...(a.withInsight
            ? {
                aiSummary: a.note,
                sentiment: a.sentiment,
                nextStep: a.nextStep,
              }
            : {}),
        },
      });
      activityCount++;
    }

    if (!isWon && !isLost) {
      const task = await prisma.task.create({
        data: {
          companyId: company.id,
          title: `Relancer ${fixture.enseigne}`,
          type: "RELANCE",
          dueDate: daysAgo(-(3 + (i % 7))),
          done: false,
          source: "AI_NEXTSTEP",
        },
      });
      taskCount++;
      await prisma.task.create({
        data: {
          companyId: company.id,
          title: `Appel de qualification — ${fixture.enseigne}`,
          type: "APPEL",
          dueDate: daysAgo(10 - i),
          done: true,
          doneAt: daysAgo(10 - i),
          source: "MANUAL",
        },
      });
      taskCount++;
      void task;
    }

    await prisma.stageChange.create({
      data: { companyId: company.id, from: null, to: fixture.stage, at: daysAgo(60 - i) },
    });
    stageChangeCount++;
  }

  // Finance cockpit fixtures — not company-scoped except the invoices.
  const financeLabels = [
    "Abonnement CRM interne",
    "Abonnement outil emailing",
    "Salaire commercial junior",
    "Achat matériel bureautique",
    "Prestation graphiste (plaquette)",
    "Facture — Cabinet Lemoine & Associés",
    "Facture — Assurances Dubois Frères",
  ];
  await prisma.financeEntry.deleteMany({ where: { label: { in: financeLabels } } });

  await prisma.financeEntry.create({
    data: {
      direction: "OUT", kind: "SUBSCRIPTION", label: "Abonnement CRM interne", vendor: "Mimir",
      category: "Logiciels", amount: 4900, recurrence: "MONTHLY", status: "ACTIVE",
      startDate: daysAgo(180), renewsAt: daysAgo(-10),
    },
  });
  await prisma.financeEntry.create({
    data: {
      direction: "OUT", kind: "SUBSCRIPTION", label: "Abonnement outil emailing", vendor: "SendPro",
      category: "Logiciels", amount: 2900, recurrence: "MONTHLY", status: "TRIAL",
      startDate: daysAgo(10), trialEndsAt: daysAgo(-4),
    },
  });
  await prisma.financeEntry.create({
    data: {
      direction: "OUT", kind: "STAFF", label: "Salaire commercial junior", vendor: null,
      category: "Sous-traitance", amount: 280_000, recurrence: "MONTHLY", status: "ACTIVE",
      startDate: daysAgo(90),
    },
  });
  await prisma.financeEntry.create({
    data: {
      direction: "OUT", kind: "EXPENSE", label: "Achat matériel bureautique", vendor: "Bureau Plus",
      category: "Matériel", amount: 65_000, recurrence: "NONE", status: "ACTIVE", date: daysAgo(45),
    },
  });
  await prisma.financeEntry.create({
    data: {
      direction: "OUT", kind: "EXPENSE", label: "Prestation graphiste (plaquette)", vendor: "Studio Créa",
      category: "Marketing", amount: 120_000, recurrence: "NONE", status: "ACTIVE", date: daysAgo(20),
    },
  });
  if (wonCompanyIds[0]) {
    await prisma.financeEntry.create({
      data: {
        direction: "IN", kind: "INVOICE", label: "Facture — Cabinet Lemoine & Associés",
        vendor: "Cabinet Lemoine & Associés", category: "Revenu", amount: 690_000, status: "SENT",
        date: daysAgo(5), dueDate: daysAgo(-25), companyId: wonCompanyIds[0],
      },
    });
  }
  if (wonCompanyIds[1]) {
    await prisma.financeEntry.create({
      data: {
        direction: "IN", kind: "INVOICE", label: "Facture — Assurances Dubois Frères",
        vendor: "Assurances Dubois Frères", category: "Revenu", amount: 462_000, status: "PAID",
        date: daysAgo(30), dueDate: daysAgo(0), companyId: wonCompanyIds[1],
      },
    });
  }

  console.log(
    `✓ Demo data seeded — ${COMPANIES.length} companies, ${contactCount} contacts, ` +
      `${dealCount} deals, ${activityCount} activities, ${taskCount} tasks, ` +
      `${stageChangeCount} stage changes, ${financeLabels.length} finance entries.`,
  );

  await prisma.$disconnect();
  await control.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

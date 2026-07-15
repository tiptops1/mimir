import "dotenv/config";
import { extractInsight, aiEnabled } from "../src/lib/ai-extract";

// Read-only probe: runs the EXACT Gemini path the cron uses (extractInsight) on a
// synthetic prospect meeting. No DB touched, no prod data mutated — it just proves
// the calendar→Gemini "brain" works and shows the structured signal it returns.
//
//   GEMINI_API_KEY=... npx tsx scripts/test-ai-insight.ts
// (or put GEMINI_API_KEY in .env first)

async function main() {
  if (!aiEnabled()) {
    console.error("AI disabled: set GEMINI_API_KEY (or ANTHROPIC_API_KEY) in env/.env");
    process.exit(1);
  }
  console.log("provider:", process.env.GEMINI_API_KEY ? "gemini" : "anthropic");

  // The kind of thing a Google Calendar event becomes after calendar-sync:
  // a MEETING activity with a subject + description body, matched to a company.
  const sample = {
    kind: "MEETING" as const,
    subject: "RDV découverte – Cabinet Durand Assurances",
    companyName: "Cabinet Durand Assurances",
    participants: ["Courtier", "M. Durand", "Mme Lefevre"],
    body: `Réunion de découverte de 45 min avec M. Durand (gérant) et Mme Lefevre (resp. production).
Le cabinet gère ~600 contrats IARD et cherche à digitaliser son suivi commercial : aujourd'hui tout
est sur Excel et ils perdent des relances. M. Durand est très intéressé par le pipeline et le scoring
des prospects, mais veut une démo concrète sur leurs propres données avant d'engager quoi que ce soit.
Budget évoqué : ils sont ouverts mais prudents. Ils repartent voir leur associé absent aujourd'hui.
Action convenue : on leur envoie une proposition chiffrée et on cale une démo la semaine prochaine.`,
  };

  // Stage keys are config data now (StageDefinition) — this probe touches no DB,
  // so it uses the default seeded stages (see scripts/seed-config.ts).
  const stageKeys = [
    "A_QUALIFIER",
    "A_CONTACTER",
    "CONTACTE",
    "RDV_OBTENU",
    "DEMO_REALISEE",
    "PROPOSITION_ENVOYEE",
    "GAGNE",
    "PERDU",
  ];

  const t0 = Date.now();
  const insight = await extractInsight(sample, stageKeys);
  const ms = Date.now() - t0;

  if (!insight) {
    console.error(`\nNo insight returned (API error or unparsable) after ${ms}ms.`);
    process.exit(2);
  }
  console.log(`\nGemini responded in ${ms}ms:\n`);
  console.log(JSON.stringify(insight, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

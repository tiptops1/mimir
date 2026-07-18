import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";
import {
  CLASSIFY_BATCH_SIZE,
  classifyBatch,
  getClassifierPrompt,
  partitionByVerdict,
} from "../../src/lib/rag/classify";
import { SAMPLE_INBOX, CORPUS_STATS, type InboundEmail } from "./sample-inbox";

// G2 evidence — quantify what a "typical month" of client email contains for
// the platform's assumed vertical (multi-line FR insurance brokerage), and
// MEASURE the S11 health classifier against it. This is the artifact that lets
// docs/mimir/decisions.md close G2 without a real client: the health-data
// fraction is a computed number over a labeled corpus, and the classifier's
// recall on that health slice is measured, not assumed.
//
//   npx tsx scripts/huginn/g2-evidence.ts          # --dry: composition only, no AI
//   npx tsx scripts/huginn/g2-evidence.ts --live    # run corpus through the Haiku classifier
//
// Prints ASCII only (cp1252 console — see CLAUDE.md); never echoes the French
// email bodies. Read-only w.r.t. domain data; --live writes one AiUsage row per
// batch via the metered router (~5 Haiku calls total, trivial budget).

// The classifier ingests free text. Huginn classifies an inbound email as one
// unit (subject + body), so one email = one chunk here.
function emailToChunk(e: InboundEmail, seq: number): { seq: number; text: string } {
  return { seq, text: `${e.subject}\n\n${e.body}` };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(0)}%`;
}

function reportComposition() {
  console.log("=== Modeled typical-month inbox (ground truth) ===");
  console.log(`Total emails: ${CORPUS_STATS.total}`);
  console.log(
    `Carrying health data: ${CORPUS_STATS.healthTrue} (${pct(
      CORPUS_STATS.healthTrue,
      CORPUS_STATS.total,
    )})`,
  );
  console.log("By category:");
  for (const [cat, n] of Object.entries(CORPUS_STATS.byCategory).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${cat.padEnd(18)} ${n}`);
  }
  console.log("Health-data emails (ids):");
  console.log(
    "  " +
      SAMPLE_INBOX.filter((e) => e.containsHealthData)
        .map((e) => e.id)
        .join(", "),
  );
}

async function runLive() {
  const control = new ControlClient();
  try {
    const tenant = await control.tenant.findUnique({
      where: { slug: "crm_demo" },
      select: { connectionString: true },
    });
    if (!tenant) throw new Error("Unknown tenant: crm_demo");

    const prisma = new TenantClient({
      datasourceUrl: decrypt(tenant.connectionString),
    });
    try {
      const prompt = await getClassifierPrompt(prisma);
      const chunks = SAMPLE_INBOX.map((e, i) => emailToChunk(e, i));

      // Mirror ingest.ts: classify in batches, partition (flagged = quarantined).
      const flaggedSeqs = new Set<number>();
      for (let i = 0; i < chunks.length; i += CLASSIFY_BATCH_SIZE) {
        const batch = chunks.slice(i, i + CLASSIFY_BATCH_SIZE);
        const verdicts = await classifyBatch(prisma, prompt, batch);
        const part = partitionByVerdict(batch, verdicts);
        for (const f of part.flagged) flaggedSeqs.add(f.seq);
      }

      // Confusion matrix vs ground truth.
      let tp = 0;
      let fp = 0;
      let fn = 0;
      let tn = 0;
      const fpIds: string[] = [];
      const fnIds: string[] = [];
      SAMPLE_INBOX.forEach((e, seq) => {
        const flagged = flaggedSeqs.has(seq);
        if (e.containsHealthData && flagged) tp++;
        else if (e.containsHealthData && !flagged) {
          fn++;
          fnIds.push(e.id);
        } else if (!e.containsHealthData && flagged) {
          fp++;
          fpIds.push(e.id);
        } else tn++;
      });

      console.log("");
      console.log("=== S11 classifier vs ground truth (crm_demo prompt) ===");
      console.log(`Flagged (would be quarantined): ${flaggedSeqs.size}`);
      console.log(`  TP ${tp}  FP ${fp}  FN ${fn}  TN ${tn}`);
      console.log(`  Recall (health caught):   ${pct(tp, tp + fn)}`);
      console.log(`  Precision (flag correct):  ${pct(tp, tp + fp)}`);
      if (fnIds.length) console.log(`  MISSED health (FN): ${fnIds.join(", ")}`);
      if (fpIds.length) console.log(`  Over-flagged (FP):  ${fpIds.join(", ")}`);
      console.log("");
      console.log(
        "D3 consequence: every flagged email is quarantined as hash + verdict",
      );
      console.log(
        "before storage/embedding; its free text is never persisted. Clean",
      );
      console.log("email proceeds to retrieve -> draft (Huginn, S14).");
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await control.$disconnect();
  }
}

async function main() {
  const live = process.argv.includes("--live");
  reportComposition();
  if (!live) {
    console.log("");
    console.log("(dry run — pass --live to measure against the Haiku classifier)");
    return;
  }
  await runLive();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

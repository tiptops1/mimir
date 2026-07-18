import "dotenv/config";
import { KNOWLEDGE_PACK } from "./knowledge-pack";

// S14b — seed the demo support knowledge pack through the REAL Mimisbrunnr
// ingest route (chunk -> health classify -> embed -> store). Idempotent: the
// route answers 409 for content already ingested (checksum match).
//
//   npx tsx scripts/huginn/seed-knowledge.ts [baseUrl] [tenantSlug]
//
// Defaults: http://localhost:3001, crm_demo. Requires the dev server AND the
// Inngest dev server running, plus CRON_SECRET in .env. ASCII output only.

const BASE = process.argv[2] ?? "http://localhost:3001";
const TENANT = process.argv[3] ?? "crm_demo";

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set in .env");

  let created = 0;
  let skipped = 0;
  for (const doc of KNOWLEDGE_PACK) {
    const res = await fetch(
      `${BASE}/api/mimisbrunnr/ingest?tenant=${encodeURIComponent(TENANT)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: doc.title,
          text: doc.text,
          sourceType: "import",
        }),
      },
    );
    const json = (await res.json()) as { documentId?: string; error?: string };
    if (res.status === 409) {
      skipped++;
      console.log(`- skipped (already ingested): doc ${created + skipped}`);
    } else if (res.ok) {
      created++;
      console.log(`+ ingest queued: ${json.documentId}`);
    } else {
      throw new Error(`Ingest failed (${res.status}): ${json.error ?? "?"}`);
    }
  }
  console.log(`Done. queued=${created} skipped=${skipped} of ${KNOWLEDGE_PACK.length}`);
  console.log("Watch the Inngest dev UI for mimisbrunnr-ingest-document runs.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

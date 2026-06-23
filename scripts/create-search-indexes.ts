import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Create the MongoDB Atlas Search indexes that power the global search bar.
// Run once (idempotent) against the Atlas cluster — after a schema/field change
// you can drop + re-run. Indexes build asynchronously; allow ~a minute before
// `$search` returns results (until then the app falls back to regex search).
//
//   npm run search:indexes
//
// Dynamic mapping = every field is indexed, so new fields are searchable with
// no index change. Atlas Search itself is included free on all Atlas tiers
// (M0 allows up to 3 search indexes); it shares the cluster's resources.

const prisma = new PrismaClient();

// One index named "default" per collection (matches src/lib/search.ts).
const COLLECTIONS = ["Company", "Contact"];
const DEFINITION = { mappings: { dynamic: true } };

async function ensure(collection: string): Promise<void> {
  try {
    await prisma.$runCommandRaw({
      createSearchIndexes: collection,
      indexes: [{ name: "default", definition: DEFINITION }],
    });
    console.log(`✓ ${collection}: search index "default" created`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/already exists|Duplicate|IndexAlreadyExists/i.test(msg)) {
      console.log(`· ${collection}: index already exists — skipped`);
      return;
    }
    if (/Search Index Commands.*Atlas|not supported|Unrecognized|CommandNotFound/i.test(msg)) {
      console.error(
        `✗ ${collection}: this Mongo doesn't support Atlas Search (need an Atlas cluster). ` +
          `The app still works via the regex fallback. (${msg})`,
      );
      return;
    }
    throw e;
  }
}

async function main() {
  for (const c of COLLECTIONS) await ensure(c);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

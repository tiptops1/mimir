import "dotenv/config";
import { PrismaClient as ControlClient } from "../../src/generated/control";
import { PrismaClient as TenantClient } from "@prisma/client";
import { decrypt } from "../../src/lib/crypto";
import { checkAndReserveIndexSlot, indexBudgetSnapshot } from "../../src/lib/rag/index-budget";
import { ensureVectorIndex, isVectorIndexReady } from "../../src/lib/rag/vector-index";

// One-off backfill for tenants provisioned before S12 added vector-index
// provisioning to scripts/provision-tenant.ts (crm_demo). Not part of any
// seed chain — re-runnable, idempotent (ensureVectorIndex skips if it
// already exists; the budget slot is only reserved once per successful run).
//
//   npx tsx scripts/rag/provision-vector-index.ts [slug=crm_demo]

async function main() {
  const slug = process.argv[2] ?? "crm_demo";
  const control = new ControlClient();
  try {
    const tenant = await control.tenant.findUnique({
      where: { slug },
      select: { connectionString: true },
    });
    if (!tenant) throw new Error(`Unknown tenant: ${slug}`);

    const before = await indexBudgetSnapshot(control);
    console.log(`Index budget before: ${before.used}/${before.limit}`);

    await checkAndReserveIndexSlot(control);

    const prisma = new TenantClient({ datasourceUrl: decrypt(tenant.connectionString) });
    try {
      await ensureVectorIndex(prisma);
      console.log("Waiting for the index to build (Atlas takes ~a minute)…");
      const ready = await isVectorIndexReady(prisma);
      console.log(ready ? "✓ vector_default is READY/queryable" : "· not ready yet — re-check shortly");
    } finally {
      await prisma.$disconnect();
    }

    const after = await indexBudgetSnapshot(control);
    console.log(`Index budget after: ${after.used}/${after.limit}`);
  } finally {
    await control.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authorized } from "@/lib/cron-auth";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { controlPrisma } from "@/lib/control-db";
import { getTenantPrisma } from "@/lib/tenant-db";
import { decrypt } from "@/lib/crypto";
import { sha256 } from "@/lib/rag/classify";

// S11 — Mimisbrunnr ingestion trigger (proof-route pattern; the demo UI is
// S13). Creates a KnowledgeDocument (PENDING, rawText held only until the
// pipeline scrubs it) and emits the IDs-only Inngest event:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     -H "content-type: application/json" \
//     -d '{"title":"...","text":"..."}' \
//     "https://<app>/api/mimisbrunnr/ingest?tenant=crm_demo"

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  sourceType: z.string().min(1).optional().default("manual"),
});

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!jobsEnabled()) {
    return NextResponse.json(
      { error: "Jobs disabled (no INNGEST_SIGNING_KEY / INNGEST_DEV)" },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { title, text, sourceType } = parsed.data;

  const slug = req.nextUrl.searchParams.get("tenant") ?? "crm_demo";
  const tenant = await controlPrisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, connectionString: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: `Unknown tenant: ${slug}` }, { status: 404 });
  }
  const prisma = getTenantPrisma(decrypt(tenant.connectionString));

  // Idempotent re-ingest: same content (by checksum) that isn't FAILED is a
  // no-op — re-ingesting after a failure or a prompt fix is always allowed.
  const checksum = sha256(text);
  const existing = await prisma.knowledgeDocument.findFirst({
    where: { checksum, status: { not: "FAILED" } },
    select: { id: true, status: true },
  });
  if (existing) {
    return NextResponse.json(
      { skipped: true, documentId: existing.id, status: existing.status },
      { status: 409 },
    );
  }

  const doc = await prisma.knowledgeDocument.create({
    data: { title, sourceType, checksum, rawText: text },
    select: { id: true },
  });

  const { ids } = await inngest.send({
    name: "mimisbrunnr/document.ingest.requested",
    data: { tenantId: tenant.id, documentId: doc.id },
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    tenant: tenant.slug,
    documentId: doc.id,
    eventIds: ids,
  });
}

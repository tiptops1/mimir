import { NonRetriableError } from "inngest";
import { z } from "zod";
import { inngest } from "./client";
import { tenantPrismaById } from "./tenant";
import { chunkText } from "@/lib/rag/chunk";
import {
  CLASSIFY_BATCH_SIZE,
  classifyBatch,
  getClassifierPrompt,
  partitionByVerdict,
  type PartitionedChunks,
} from "@/lib/rag/classify";
import { embedTexts } from "@/lib/ai/embed";

// S11 — Mimisbrunnr ingestion: doc -> chunk -> health classifier -> quarantine
// flagged BEFORE storage/embedding -> embed -> store (D3 exclusion posture).
// Payload is IDs only; the raw text travels through the DB (KnowledgeDocument
// .rawText) and is scrubbed once processing completes, so nothing the
// classifier didn't pass persists anywhere.

export const ingestPayload = z.object({
  tenantId: z.string().min(1),
  documentId: z.string().min(1),
});

async function markFailed(tenantId: string, documentId: string, error: string) {
  const prisma = await tenantPrismaById(tenantId);
  await prisma.knowledgeDocument.update({
    where: { id: documentId },
    data: { status: "FAILED", error },
  });
}

export const ingestDocument = inngest.createFunction(
  {
    id: "mimisbrunnr-ingest-document",
    triggers: [{ event: "mimisbrunnr/document.ingest.requested" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const parsed = ingestPayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { tenantId, documentId } = parsed.data;
      await markFailed(tenantId, documentId, error.message);
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          entity: "KNOWLEDGE_DOCUMENT",
          entityId: documentId,
          data: { job: "ingest", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId }) => {
    const { tenantId, documentId } = ingestPayload.parse(event.data);

    // 1. Load + chunk (pure, deterministic — safe to re-run on retry).
    const chunks = await step.run("load-and-chunk", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const doc = await prisma.knowledgeDocument.findUnique({
        where: { id: documentId },
        select: { status: true, rawText: true },
      });
      if (!doc) throw new NonRetriableError(`Unknown document: ${documentId}`);
      if (doc.status === "INGESTED") {
        throw new NonRetriableError(`Document already ingested: ${documentId}`);
      }
      if (!doc.rawText) {
        throw new NonRetriableError(`Document has no rawText: ${documentId}`);
      }
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: { status: "PROCESSING", ingestRunId: runId },
      });
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_started",
          runId,
          entity: "KNOWLEDGE_DOCUMENT",
          entityId: documentId,
          data: { job: "ingest" },
        },
      });
      return chunkText(doc.rawText).map((text, seq) => ({ seq, text }));
    });

    // 2. Classify every chunk BEFORE anything is stored or embedded. Fail
    // closed: a batch whose call fails (budget exhausted, API error) or whose
    // output doesn't validate throws -> step retries -> onFailure marks the
    // doc FAILED with nothing stored. A batch that validates but is missing
    // individual verdicts quarantines those chunks (partitionByVerdict).
    const partitioned = await step.run("classify", async (): Promise<
      PartitionedChunks & { promptKey: string; promptVersion: number }
    > => {
      const prisma = await tenantPrismaById(tenantId);
      const prompt = await getClassifierPrompt(prisma);
      const clean: PartitionedChunks["clean"] = [];
      const flagged: PartitionedChunks["flagged"] = [];
      for (let i = 0; i < chunks.length; i += CLASSIFY_BATCH_SIZE) {
        const batch = chunks.slice(i, i + CLASSIFY_BATCH_SIZE);
        const verdicts = await classifyBatch(prisma, prompt, batch);
        if (verdicts === null) {
          throw new Error(
            `Health classifier unavailable for chunks ${i}-${i + batch.length - 1} — fail closed, nothing stored`,
          );
        }
        const part = partitionByVerdict(batch, verdicts);
        clean.push(...part.clean);
        flagged.push(...part.flagged);
      }
      return { clean, flagged, promptKey: prompt.key, promptVersion: prompt.version };
    });

    // 3. Quarantine flagged chunks — hash + verdict only, append-only.
    await step.run("quarantine", async () => {
      if (partitioned.flagged.length === 0) return;
      const prisma = await tenantPrismaById(tenantId);
      // Append-only collection — idempotency on retry comes from skipping
      // seqs already written for this doc, never from deleting.
      const existing = await prisma.quarantineItem.findMany({
        where: { docId: documentId },
        select: { seq: true },
      });
      const done = new Set(existing.map((q) => q.seq));
      const toWrite = partitioned.flagged.filter((f) => !done.has(f.seq));
      if (toWrite.length === 0) return;
      await prisma.quarantineItem.createMany({
        data: toWrite.map((f) => ({
          docId: documentId,
          seq: f.seq,
          contentHash: f.contentHash,
          verdict: f.verdict,
          promptKey: partitioned.promptKey,
          promptVersion: partitioned.promptVersion,
        })),
      });
      for (const f of toWrite) {
        await prisma.agentEvent.create({
          data: {
            module: "mimisbrunnr",
            category: "ingestion",
            action: "quarantined",
            runId,
            entity: "KNOWLEDGE_DOCUMENT",
            entityId: documentId,
            data: { seq: f.seq, categories: f.verdict.categories, confidence: f.verdict.confidence },
          },
        });
      }
    });

    // 4. Embed clean chunks (768-dim Gemini vectors; throws -> step retry).
    const vectors = await step.run("embed", async () => {
      const prisma = await tenantPrismaById(tenantId);
      return embedTexts(
        prisma,
        partitioned.clean.map((c) => c.text),
        "RETRIEVAL_DOCUMENT",
      );
    });

    // 5. Store clean chunks + finalize: counts, INGESTED, rawText scrubbed.
    const summary = await step.run("store-and-finalize", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const now = new Date();
      // Idempotent on retry.
      await prisma.knowledgeChunk.deleteMany({ where: { docId: documentId } });
      if (partitioned.clean.length > 0) {
        await prisma.knowledgeChunk.createMany({
          data: partitioned.clean.map((c, i) => ({
            docId: documentId,
            seq: c.seq,
            text: c.text,
            embedding: vectors[i],
            embeddedAt: now,
          })),
        });
      }
      await prisma.knowledgeDocument.update({
        where: { id: documentId },
        data: {
          status: "INGESTED",
          chunkCount: partitioned.clean.length,
          quarantinedCount: partitioned.flagged.length,
          rawText: null, // exclusion posture: the raw source never persists
          error: null,
        },
      });
      const counts = {
        chunks: partitioned.clean.length,
        quarantined: partitioned.flagged.length,
      };
      for (const action of ["ingested", "embedded"] as const) {
        await prisma.agentEvent.create({
          data: {
            module: "mimisbrunnr",
            category: "ingestion",
            action,
            runId,
            entity: "KNOWLEDGE_DOCUMENT",
            entityId: documentId,
            data: counts,
          },
        });
      }
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_finished",
          runId,
          entity: "KNOWLEDGE_DOCUMENT",
          entityId: documentId,
          data: { job: "ingest", ...counts },
        },
      });
      return counts;
    });

    return { ok: true, documentId, ...summary };
  },
);

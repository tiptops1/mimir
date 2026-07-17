import { NonRetriableError } from "inngest";
import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";
import { inngest } from "./client";
import { tenantPrismaById } from "./tenant";
import { parseCsvWithHeader } from "@/lib/import/csv";
import {
  buildTargetCatalog,
  mappingSchema,
  type ImportMappingConfig,
  type ImportTarget,
} from "@/lib/import/mapping";
import {
  buildRowPayloads,
  freeTextKeys,
  type RowPayloads,
  type StageDefLite,
} from "@/lib/import/coerce";
import {
  buildExistingIndex,
  computeRowKey,
  planRow,
  registerPlanned,
  shouldSkipContact,
} from "@/lib/import/dedupe";
import {
  CLASSIFY_BATCH_SIZE,
  classifyBatch,
  getClassifierPrompt,
  partitionByVerdict,
} from "@/lib/rag/classify";
import type { FieldDef } from "@/lib/field-config";

// S13b — ETL/onboarding import: uploaded CRM export -> parse + plan (dedupe)
// -> [DRY: report] / [COMMIT: health-classify free text -> quarantine flagged
// fields -> idempotent entity writes]. Payload is IDs only (S4 rule); the CSV
// travels through ImportRun.rawText and is scrubbed once parsed (D3 posture,
// KnowledgeDocument precedent).
//
// Deliberately NOT routed through the Heimdallr ledger: an import the admin
// explicitly commits from the wizard is a human action (same class as the
// existing server actions), not an autonomous agent proposal — D5's "one
// bridge" governs agent side effects. Audit = AuditLog row at the action
// boundary + the AgentEvent stream written here.

export const importRunPayload = z.object({
  tenantId: z.string().min(1),
  importRunId: z.string().min(1),
  mode: z.enum(["DRY", "COMMIT"]),
});

/** Rows written per commit step — keeps every step far under the 60 s cap. */
export const COMMIT_BATCH_SIZE = 25;

async function markFailed(tenantId: string, importRunId: string, error: string) {
  const prisma = await tenantPrismaById(tenantId);
  await prisma.importRun.update({
    where: { id: importRunId },
    data: { status: "FAILED", error },
  });
}

interface TenantImportConfig {
  mapping: ImportMappingConfig;
  catalog: ImportTarget[];
  stages: StageDefLite[];
}

async function loadConfig(
  prisma: PrismaClient,
  mappingJson: unknown,
): Promise<TenantImportConfig> {
  const mapping = mappingSchema.parse(mappingJson);
  const defs = await prisma.fieldDefinition.findMany({
    where: { entity: { in: ["COMPANY", "CONTACT", "DEAL"] } },
  });
  const byEntity: Partial<Record<"COMPANY" | "CONTACT" | "DEAL", FieldDef[]>> = {};
  for (const d of defs) {
    const entity = d.entity as "COMPANY" | "CONTACT" | "DEAL";
    (byEntity[entity] ??= []).push({
      key: d.key,
      label: d.label,
      type: d.type as FieldDef["type"],
      options: d.options,
      required: d.required,
      order: d.order,
      source: d.source as FieldDef["source"],
      section: d.section,
    });
  }
  const stages = await prisma.stageDefinition.findMany({
    select: { key: true, label: true },
    orderBy: { order: "asc" },
  });
  return { mapping, catalog: buildTargetCatalog(byEntity), stages };
}

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/** Merge only into null/empty scalar fields — the "fillEmpty" policy. */
function fillEmptyData(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(incoming)) {
    const current = existing[key];
    if (current === null || current === undefined || current === "") {
      data[key] = value;
    }
  }
  return data;
}

export const processImportRun = inngest.createFunction(
  {
    id: "system-import-run",
    triggers: [{ event: "system/import_run.process.requested" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const parsed = importRunPayload.safeParse(event.data.event.data);
      if (!parsed.success) return;
      const { tenantId, importRunId } = parsed.data;
      await markFailed(tenantId, importRunId, error.message);
      const prisma = await tenantPrismaById(tenantId);
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_failed",
          runId: event.data.run_id,
          entity: "IMPORT_RUN",
          entityId: importRunId,
          data: { job: "import", error: error.message },
        },
      });
    },
  },
  async ({ event, step, runId }) => {
    const { tenantId, importRunId, mode } = importRunPayload.parse(event.data);

    // 1. Parse + plan. When rawText is already scrubbed (commit after a dry
    // run, or a re-run of a committed file) the existing ImportRecords ARE the
    // plan — skip re-planning so re-runs converge instead of resetting state.
    const { rowCount } = await step.run("parse-and-plan", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const run = await prisma.importRun.findUnique({
        where: { id: importRunId },
        select: { status: true, rawText: true, mapping: true, rowCount: true },
      });
      if (!run) throw new NonRetriableError(`Unknown import run: ${importRunId}`);
      if (!run.mapping) throw new NonRetriableError(`Import run has no mapping: ${importRunId}`);

      await prisma.importRun.update({
        where: { id: importRunId },
        data: {
          status: mode === "DRY" ? "DRY_RUNNING" : "COMMITTING",
          jobRunId: runId,
          error: null,
        },
      });
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_started",
          runId,
          entity: "IMPORT_RUN",
          entityId: importRunId,
          data: { job: "import", mode },
        },
      });

      if (!run.rawText) {
        const existing = await prisma.importRecord.count({ where: { runId: importRunId } });
        if (existing === 0) {
          throw new NonRetriableError(`Import run has neither rawText nor records: ${importRunId}`);
        }
        return { rowCount: run.rowCount };
      }

      const { mapping, catalog, stages } = await loadConfig(prisma, run.mapping);
      const parsed = parseCsvWithHeader(run.rawText);

      const companies = await prisma.company.findMany({
        select: { id: true, siret: true, nomSociete: true, enseigne: true, siteWeb: true },
      });
      const index = buildExistingIndex(companies);

      // Pre-commit re-plan is a reset, not an append — records are only ever
      // recreated while nothing has been committed yet.
      await prisma.importRecord.deleteMany({ where: { runId: importRunId } });

      const records: Prisma.ImportRecordCreateManyInput[] = parsed.rows.map(
        (cells, rowIndex) => {
          const payloads = buildRowPayloads(cells, mapping.columns, catalog, stages);
          const keyResult = computeRowKey(payloads.company);
          if (!keyResult.ok || payloads.errors.length > 0) {
            return {
              runId: importRunId,
              rowIndex,
              rowKey: keyResult.ok ? keyResult.rowKey : `ERROR-${rowIndex}`,
              status: "ERROR",
              errors: [...(keyResult.ok ? [] : [keyResult.error]), ...payloads.errors],
            };
          }
          const plan = planRow(
            keyResult.rowKey,
            payloads.company,
            index,
            mapping.options.duplicatePolicy,
          );
          if (plan.action === "CREATE") registerPlanned(index, keyResult.rowKey);
          return {
            runId: importRunId,
            rowIndex,
            rowKey: keyResult.rowKey,
            status: "PLANNED",
            plannedAction: plan.action,
            dedupeHints: plan.hints.length > 0 ? asJson(plan.hints) : undefined,
            raw: asJson({ ...payloads, existingCompanyId: plan.existingCompanyId }),
          };
        },
      );
      if (records.length > 0) {
        await prisma.importRecord.createMany({ data: records });
      }

      // Scrub the raw CSV — the parsed records now carry everything (D3).
      await prisma.importRun.update({
        where: { id: importRunId },
        data: { rowCount: records.length, rawText: null },
      });
      return { rowCount: records.length };
    });

    // 2. Dry run stops here: the plan IS the report.
    if (mode === "DRY") {
      const stats = await step.run("finalize-dry", async () => {
        const prisma = await tenantPrismaById(tenantId);
        const stats = await computeStats(prisma, importRunId);
        await prisma.importRun.update({
          where: { id: importRunId },
          data: { status: "DRY_RUN_DONE", stats: asJson(stats) },
        });
        await prisma.agentEvent.create({
          data: {
            module: "system",
            category: "queue",
            action: "run_finished",
            runId,
            entity: "IMPORT_RUN",
            entityId: importRunId,
            data: { job: "import", mode, ...stats },
          },
        });
        return stats;
      });
      return { ok: true, importRunId, mode, ...stats };
    }

    // 3. Commit in bounded batches. Only PLANNED records are processed, so a
    // retried step (or a whole re-run) skips rows already in a terminal state.
    const batchCount = Math.ceil(rowCount / COMMIT_BATCH_SIZE);
    for (let b = 0; b < batchCount; b++) {
      await step.run(`commit-batch-${b}`, async () => {
        const prisma = await tenantPrismaById(tenantId);
        const run = await prisma.importRun.findUnique({
          where: { id: importRunId },
          select: { mapping: true },
        });
        if (!run?.mapping) throw new NonRetriableError(`Import run lost its mapping: ${importRunId}`);
        const { mapping, catalog, stages } = await loadConfig(prisma, run.mapping);
        void stages;
        const records = await prisma.importRecord.findMany({
          where: {
            runId: importRunId,
            status: "PLANNED",
            rowIndex: { gte: b * COMMIT_BATCH_SIZE, lt: (b + 1) * COMMIT_BATCH_SIZE },
          },
          orderBy: { rowIndex: "asc" },
        });
        if (records.length === 0) return;

        // 3a. Health-classify each row's free-text bundle BEFORE any write
        // (same fail-closed posture as ingest.ts: classifier unavailable ->
        // throw -> retries -> run FAILED with this batch unwritten).
        const textChunks = records
          .map((r) => {
            const raw = r.raw as unknown as RowPayloads;
            const text = (raw.textFields ?? []).join("\n\n").trim();
            return { seq: r.rowIndex, text };
          })
          .filter((c) => c.text.length > 0);

        const flaggedSeqs = new Map<number, { contentHash: string; verdict: unknown }>();
        let promptMeta: { key: string; version: number } | null = null;
        if (textChunks.length > 0) {
          const prompt = await getClassifierPrompt(prisma);
          promptMeta = { key: prompt.key, version: prompt.version };
          for (let i = 0; i < textChunks.length; i += CLASSIFY_BATCH_SIZE) {
            const batch = textChunks.slice(i, i + CLASSIFY_BATCH_SIZE);
            const verdicts = await classifyBatch(prisma, prompt, batch);
            if (verdicts === null) {
              throw new Error(
                `Health classifier unavailable for import rows ${batch[0].seq}-${batch[batch.length - 1].seq} — fail closed, nothing written`,
              );
            }
            const part = partitionByVerdict(batch, verdicts);
            for (const f of part.flagged) {
              flaggedSeqs.set(f.seq, { contentHash: f.contentHash, verdict: f.verdict });
            }
          }
        }

        // 3b. Quarantine flagged rows — hash + verdict only, append-only,
        // idempotent by skipping seqs already written for this run.
        if (flaggedSeqs.size > 0 && promptMeta) {
          const existing = await prisma.quarantineItem.findMany({
            where: { docId: importRunId },
            select: { seq: true },
          });
          const done = new Set(existing.map((q) => q.seq));
          const toWrite = [...flaggedSeqs.entries()].filter(([seq]) => !done.has(seq));
          if (toWrite.length > 0) {
            await prisma.quarantineItem.createMany({
              data: toWrite.map(([seq, f]) => ({
                docId: importRunId,
                seq,
                contentHash: f.contentHash,
                verdict: asJson(f.verdict),
                promptKey: promptMeta.key,
                promptVersion: promptMeta.version,
              })),
            });
            for (const [seq] of toWrite) {
              await prisma.agentEvent.create({
                data: {
                  module: "system",
                  category: "import",
                  action: "quarantined",
                  runId,
                  entity: "IMPORT_RUN",
                  entityId: importRunId,
                  data: { rowIndex: seq },
                },
              });
            }
          }
        }

        // 3c. Entity writes, one row at a time (rowKey upsert = convergent).
        const textKeys = freeTextKeys(mapping.columns, catalog);
        for (const record of records) {
          const raw = record.raw as unknown as RowPayloads & {
            existingCompanyId: string | null;
          };
          const flagged = flaggedSeqs.has(record.rowIndex);

          if (record.plannedAction === "SKIP") {
            await prisma.importRecord.update({
              where: { id: record.id },
              data: { status: "SKIPPED_DUPLICATE" },
            });
            continue;
          }

          // Strip free-text values from a flagged row — the row imports, the
          // flagged text never lands anywhere but the quarantine hash (D3).
          const company = { ...raw.company };
          const companyCustom = { ...raw.companyCustom };
          const contact = { ...raw.contact };
          const contactCustom = { ...raw.contactCustom };
          const deal = { ...raw.deal };
          const dealCustom = { ...raw.dealCustom };
          if (flagged) {
            for (const k of textKeys) {
              const bucket =
                k.entity === "COMPANY"
                  ? k.source === "NATIVE" ? company : companyCustom
                  : k.entity === "CONTACT"
                    ? k.source === "NATIVE" ? contact : contactCustom
                    : k.source === "NATIVE" ? deal : dealCustom;
              delete bucket[k.key];
            }
          }

          const entityIds: { companyId?: string; contactId?: string; dealId?: string } = {};

          if (record.plannedAction === "UPDATE" && raw.existingCompanyId) {
            const existing = await prisma.company.findUnique({
              where: { id: raw.existingCompanyId },
            });
            if (existing) {
              const { siret: _siret, ...rest } = company;
              void _siret;
              const data = fillEmptyData(
                existing as unknown as Record<string, unknown>,
                rest,
              );
              const mergedCustom = {
                ...companyCustom,
                ...(existing.customFields as Record<string, unknown> | null ?? {}),
              };
              await prisma.company.update({
                where: { id: existing.id },
                data: {
                  ...data,
                  ...(Object.keys(companyCustom).length > 0
                    ? { customFields: asJson(mergedCustom) }
                    : {}),
                },
              });
              entityIds.companyId = existing.id;
            }
          } else {
            const { siret: _siret, stage, ...rest } = company;
            void _siret;
            const created = await prisma.company.upsert({
              where: { siret: record.rowKey },
              update: {}, // exists already (parallel run / earlier attempt) — leave it alone
              create: {
                ...rest,
                siret: record.rowKey,
                stage: (stage as string | undefined) ?? undefined,
                ...(Object.keys(companyCustom).length > 0
                  ? { customFields: asJson(companyCustom) }
                  : {}),
                importRunId,
              } as Prisma.CompanyUncheckedCreateInput,
            });
            entityIds.companyId = created.id;
          }

          const companyId = entityIds.companyId;
          if (companyId) {
            // Contact: create-if-absent inside the company (email, else name).
            const hasContact = Object.values(contact).some((v) => v != null);
            if (hasContact) {
              const existingContacts = await prisma.contact.findMany({
                where: { companyId },
                select: { nom: true, prenom: true, email: true },
              });
              if (!shouldSkipContact(contact, existingContacts)) {
                const createdContact = await prisma.contact.create({
                  data: {
                    ...contact,
                    ...(Object.keys(contactCustom).length > 0
                      ? { customFields: asJson(contactCustom) }
                      : {}),
                    companyId,
                    importRunId,
                  } as Prisma.ContactUncheckedCreateInput,
                });
                entityIds.contactId = createdContact.id;
              }
            }

            // Deal: create-if-absent by title. First deal on a freshly
            // created company becomes primary (mirrors the pipeline board).
            const hasDeal = Object.values(deal).some((v) => v != null);
            if (hasDeal) {
              const title = (deal.title as string | undefined) ?? "Opportunité importée";
              const existingDeal = await prisma.deal.findFirst({
                where: { companyId, title },
                select: { id: true },
              });
              if (!existingDeal) {
                const dealCount = await prisma.deal.count({ where: { companyId } });
                const createdDeal = await prisma.deal.create({
                  data: {
                    ...deal,
                    title,
                    ...(Object.keys(dealCustom).length > 0
                      ? { customFields: asJson(dealCustom) }
                      : {}),
                    companyId,
                    isPrimary: dealCount === 0,
                    ...(dealCount === 0 && company.stage
                      ? { stage: company.stage as string }
                      : {}),
                    importRunId,
                  } as Prisma.DealUncheckedCreateInput,
                });
                entityIds.dealId = createdDeal.id;
              }
            }
          }

          await prisma.importRecord.update({
            where: { id: record.id },
            data: {
              status: flagged
                ? "QUARANTINED_FIELDS"
                : record.plannedAction === "UPDATE"
                  ? "UPDATED"
                  : "CREATED",
              entityIds: asJson(entityIds),
            },
          });
        }
      });
    }

    // 4. Finalize: stats, DONE, per-row payloads scrubbed (D3 window closed).
    const stats = await step.run("finalize", async () => {
      const prisma = await tenantPrismaById(tenantId);
      const stats = await computeStats(prisma, importRunId);
      await prisma.importRecord.updateMany({
        where: { runId: importRunId },
        data: { raw: null },
      });
      await prisma.importRun.update({
        where: { id: importRunId },
        data: { status: "DONE", stats: asJson(stats), error: null },
      });
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "import",
          action: "imported",
          runId,
          entity: "IMPORT_RUN",
          entityId: importRunId,
          data: stats,
        },
      });
      await prisma.agentEvent.create({
        data: {
          module: "system",
          category: "queue",
          action: "run_finished",
          runId,
          entity: "IMPORT_RUN",
          entityId: importRunId,
          data: { job: "import", mode, ...stats },
        },
      });
      return stats;
    });

    return { ok: true, importRunId, mode, ...stats };
  },
);

type RunStats = {
  companiesCreated: number;
  companiesUpdated: number;
  skipped: number;
  contactsCreated: number;
  dealsCreated: number;
  quarantinedRows: number;
  errorRows: number;
  plannedCreate: number;
  plannedUpdate: number;
  plannedSkip: number;
};

async function computeStats(
  prisma: PrismaClient,
  importRunId: string,
): Promise<RunStats> {
  const records = await prisma.importRecord.findMany({
    where: { runId: importRunId },
    select: { status: true, plannedAction: true, entityIds: true },
  });
  const stats: RunStats = {
    companiesCreated: 0,
    companiesUpdated: 0,
    skipped: 0,
    contactsCreated: 0,
    dealsCreated: 0,
    quarantinedRows: 0,
    errorRows: 0,
    plannedCreate: 0,
    plannedUpdate: 0,
    plannedSkip: 0,
  };
  for (const r of records) {
    if (r.plannedAction === "CREATE") stats.plannedCreate++;
    if (r.plannedAction === "UPDATE") stats.plannedUpdate++;
    if (r.plannedAction === "SKIP") stats.plannedSkip++;
    if (r.status === "ERROR") stats.errorRows++;
    if (r.status === "SKIPPED_DUPLICATE") stats.skipped++;
    if (r.status === "QUARANTINED_FIELDS") stats.quarantinedRows++;
    if (r.status === "CREATED" || (r.status === "QUARANTINED_FIELDS" && r.plannedAction === "CREATE")) {
      stats.companiesCreated++;
    }
    if (r.status === "UPDATED" || (r.status === "QUARANTINED_FIELDS" && r.plannedAction === "UPDATE")) {
      stats.companiesUpdated++;
    }
    const ids = r.entityIds as { contactId?: string; dealId?: string } | null;
    if (ids?.contactId) stats.contactsCreated++;
    if (ids?.dealId) stats.dealsCreated++;
  }
  return stats;
}

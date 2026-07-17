"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { getFieldDefs } from "@/lib/field-config";
import { logAudit } from "@/lib/audit";
import { inngest, jobsEnabled } from "@/lib/jobs/client";
import { parseCsvWithHeader } from "@/lib/import/csv";
import { sha256 } from "@/lib/rag/classify";
import {
  buildTargetCatalog,
  mappingSchema,
  suggestMapping,
} from "@/lib/import/mapping";

// S13b — admin-facing actions for the onboarding import wizard. The wizard is
// server-status-driven (`ImportRun.status` decides the rendered step); these
// actions advance the status and hand the heavy work to the Inngest job.

export interface FormResult {
  error?: string;
  ok?: boolean;
}

const MAX_FILE_BYTES = 4 * 1024 * 1024; // well under Mongo's 16 MB doc limit

async function buildCatalog() {
  const [company, contact, deal] = await Promise.all([
    getFieldDefs("COMPANY"),
    getFieldDefs("CONTACT"),
    getFieldDefs("DEAL"),
  ]);
  return buildTargetCatalog({ COMPANY: company, CONTACT: contact, DEAL: deal });
}

export async function uploadImportFile(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const session = await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Sélectionnez un fichier CSV à importer." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "Fichier trop volumineux (4 Mo maximum). Découpez l'export en plusieurs fichiers." };
  }

  const text = await file.text();
  let parsed;
  try {
    parsed = parseCsvWithHeader(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fichier illisible." };
  }
  if (parsed.rows.length === 0) {
    return { error: "Le fichier ne contient aucune ligne de données." };
  }

  // Idempotent upload: same content -> same run (the ingest-route 409 pattern).
  const checksum = sha256(text);
  const existing = await prisma.importRun.findFirst({
    where: { checksum, status: { not: "FAILED" } },
    select: { id: true },
  });
  if (existing) {
    redirect(`/settings/import/${existing.id}`);
  }

  const catalog = await buildCatalog();
  const suggested = suggestMapping(parsed.headers, catalog);
  const run = await prisma.importRun.create({
    data: {
      fileName: file.name,
      checksum,
      status: "UPLOADED",
      rawText: text,
      rowCount: parsed.rows.length,
      mapping: {
        columns: suggested,
        options: { duplicatePolicy: "skip" },
      } as unknown as Prisma.InputJsonValue,
      createdBy: session.userId,
    },
  });
  redirect(`/settings/import/${run.id}`);
}

export async function saveMapping(
  runId: string,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();

  const run = await prisma.importRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (!run) return { error: "Import introuvable." };
  if (!["UPLOADED", "MAPPED", "DRY_RUN_DONE"].includes(run.status)) {
    return { error: "Le mapping ne peut plus être modifié à ce stade." };
  }

  let columns: unknown;
  try {
    columns = JSON.parse(String(formData.get("columns") ?? "[]"));
  } catch {
    return { error: "Mapping illisible." };
  }
  const parsed = mappingSchema.safeParse({
    columns,
    options: { duplicatePolicy: formData.get("duplicatePolicy") ?? "skip" },
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Mapping invalide — vérifiez les colonnes.",
    };
  }

  let mappingId: string | undefined;
  const saveAsName = String(formData.get("saveAsName") ?? "").trim();
  if (saveAsName) {
    const saved = await prisma.importMapping.upsert({
      where: { name: saveAsName },
      update: { mapping: parsed.data as unknown as Prisma.InputJsonValue },
      create: {
        name: saveAsName,
        mapping: parsed.data as unknown as Prisma.InputJsonValue,
      },
    });
    mappingId = saved.id;
  }

  await prisma.importRun.update({
    where: { id: runId },
    data: {
      mapping: parsed.data as unknown as Prisma.InputJsonValue,
      ...(mappingId ? { mappingId } : {}),
      status: "MAPPED",
    },
  });
  revalidatePath(`/settings/import/${runId}`);
  return { ok: true };
}

async function sendProcessEvent(
  runId: string,
  mode: "DRY" | "COMMIT",
): Promise<FormResult> {
  const session = await requireRole(["ADMIN"]);
  const prisma = await getTenantDb();
  if (!jobsEnabled()) {
    return { error: "La file de jobs n'est pas configurée (INNGEST_DEV/INNGEST_SIGNING_KEY)." };
  }

  const run = await prisma.importRun.findUnique({
    where: { id: runId },
    select: { status: true, mapping: true, fileName: true },
  });
  if (!run) return { error: "Import introuvable." };
  if (!run.mapping) return { error: "Validez d'abord le mapping des colonnes." };
  const allowed =
    mode === "DRY"
      ? ["MAPPED", "DRY_RUN_DONE", "FAILED"]
      : ["MAPPED", "DRY_RUN_DONE", "DONE", "FAILED"];
  if (!allowed.includes(run.status)) {
    return { error: `Impossible de lancer depuis le statut ${run.status}.` };
  }

  await prisma.importRun.update({
    where: { id: runId },
    data: { status: mode === "DRY" ? "DRY_RUNNING" : "COMMITTING", error: null },
  });
  await inngest.send({
    name: "system/import_run.process.requested",
    data: { tenantId: session.tenantId, importRunId: runId, mode },
  });
  if (mode === "COMMIT") {
    await logAudit(prisma, {
      userId: session.userId,
      action: "IMPORT_COMMIT",
      entity: "IMPORT_RUN",
      entityId: runId,
      details: `Import « ${run.fileName} » lancé`,
    });
  }
  revalidatePath(`/settings/import/${runId}`);
  return { ok: true };
}

export async function runDryRun(runId: string): Promise<FormResult> {
  return sendProcessEvent(runId, "DRY");
}

export async function commitImport(runId: string): Promise<FormResult> {
  return sendProcessEvent(runId, "COMMIT");
}

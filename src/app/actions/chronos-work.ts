"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession, requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { requireModule } from "@/lib/tenant-profile";
import { parseDuration } from "@/lib/chronos/labour";
import { deleteWorkLog, logWork } from "@/lib/chronos/work";
import { toCents } from "@/lib/chronos/margin";

/**
 * People and workshop time (S24).
 *
 * Not through the Heimdallr ledger: recording who worked how long is the
 * operator's own bookkeeping, not an agent proposing anything — the same line
 * the import wizard and the reconciliation queue sit on.
 */

export interface WorkActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

async function guard() {
  const session = await verifySession();
  await requireRole(["ADMIN", "MANAGER"]);
  await requireModule("chronos");
  return session;
}

function revalidate(unitId?: string) {
  revalidatePath("/chronos/atelier");
  revalidatePath("/chronos");
  if (unitId) revalidatePath(`/chronos/${unitId}`);
}

const personSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["EMPLOYEE", "CONTRACTOR", "SELF"]),
  hourlyRateCents: z.number().int().min(0).max(100_000_000).nullable(),
  note: z.string().max(300),
});

export async function upsertPersonSA(
  _prev: WorkActionResult | undefined,
  formData: FormData,
): Promise<WorkActionResult> {
  await guard();

  const rawRate = String(formData.get("hourlyRate") ?? "").trim();
  // Null, not 0: "no rate set" means fall back to the house rate, whereas 0
  // would mean this person's time is genuinely free.
  const hourlyRateCents = rawRate === "" ? null : toCents(rawRate);
  if (rawRate !== "" && hourlyRateCents === null) {
    return { ok: false, error: "Taux horaire illisible." };
  }

  const parsed = personSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    kind: String(formData.get("kind") ?? "EMPLOYEE"),
    hourlyRateCents,
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: "Nom requis, type invalide ou taux hors bornes." };

  const prisma = await getTenantDb();
  const id = String(formData.get("id") ?? "").trim();

  if (id) {
    await prisma.person.update({ where: { id }, data: parsed.data });
  } else {
    await prisma.person.create({ data: { ...parsed.data, active: true } });
  }

  revalidate();
  return { ok: true, message: "Intervenant enregistré." };
}

export async function deactivatePersonSA(id: string): Promise<WorkActionResult> {
  await guard();
  if (!id) return { ok: false, error: "Intervenant invalide." };
  const prisma = await getTenantDb();
  // Deactivate, never delete: their logged hours are historical cost on units
  // that may already be sold, and the cascade would silently rewrite margins.
  await prisma.person.update({ where: { id }, data: { active: false } });
  revalidate();
  return { ok: true, message: "Intervenant désactivé." };
}

export async function logWorkSA(
  _prev: WorkActionResult | undefined,
  formData: FormData,
): Promise<WorkActionResult> {
  await guard();

  const personId = String(formData.get("personId") ?? "").trim();
  const unitId = String(formData.get("unitId") ?? "").trim();
  const minutes = parseDuration(String(formData.get("duration") ?? ""));
  const rawDate = String(formData.get("performedAt") ?? "").trim();

  if (!personId || !unitId) return { ok: false, error: "Intervenant et montre requis." };
  if (minutes === null) {
    return { ok: false, error: "Durée illisible — utilisez 90, 90m, 1h30 ou 1,5h." };
  }

  const performedAt = rawDate ? new Date(rawDate) : new Date();
  if (Number.isNaN(performedAt.getTime())) return { ok: false, error: "Date invalide." };

  const prisma = await getTenantDb();
  try {
    const log = await logWork(prisma, {
      personId,
      unitId,
      minutes,
      performedAt,
      note: String(formData.get("note") ?? ""),
    });
    revalidate(unitId);
    return {
      ok: true,
      message: `${minutes} min enregistrées (${(log.costCents / 100).toFixed(2)} €).`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function deleteWorkLogSA(id: string): Promise<WorkActionResult> {
  await guard();
  if (!id) return { ok: false, error: "Saisie invalide." };
  const prisma = await getTenantDb();
  const log = await prisma.workLog.findUnique({ where: { id }, select: { unitId: true } });
  await deleteWorkLog(prisma, id);
  revalidate(log?.unitId);
  return { ok: true, message: "Saisie supprimée." };
}

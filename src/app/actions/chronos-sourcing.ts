"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession, requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { requireModule } from "@/lib/tenant-profile";

/**
 * Kairos watchlist management (S32).
 *
 * Deliberately NOT through the Heimdallr ledger, on the same reasoning as the
 * S13b import wizard and the S29 reconciliation queue: deciding what to hunt is
 * the operator's own commercial judgement, not an agent proposing anything.
 * What DOES go through the ledger is the buy offer the agent derives from it.
 *
 * Nothing here places a bid, and nothing here can approve one.
 */

export interface SourcingActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

const watchSchema = z.object({
  refId: z.string().min(1),
  // Null = no cap beyond the margin arithmetic. 100+ would let the watchlist
  // authorise paying the full resale median, so it is bounded here too.
  maxPricePct: z.number().int().min(1).max(100).nullable(),
  refurbCostCents: z.number().int().min(0).max(10_000_000),
  note: z.string().max(500),
});

async function guard() {
  const session = await verifySession();
  await requireRole(["ADMIN", "MANAGER"]);
  await requireModule("chronos");
  return session;
}

function revalidate() {
  revalidatePath("/chronos/sourcing");
}

/** Add or update the buying parameters for one reference. */
export async function upsertWatchSA(
  _prev: SourcingActionResult | undefined,
  formData: FormData,
): Promise<SourcingActionResult> {
  await guard();

  const rawPct = String(formData.get("maxPricePct") ?? "").trim();
  const rawRefurb = String(formData.get("refurbCost") ?? "").trim();

  const parsed = watchSchema.safeParse({
    refId: String(formData.get("refId") ?? ""),
    maxPricePct: rawPct === "" ? null : Number(rawPct),
    refurbCostCents: rawRefurb === "" ? 0 : Math.round(Number(rawRefurb) * 100),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, error: "Paramètres invalides (plafond 1-100 %, coût ≥ 0)." };
  }

  const prisma = await getTenantDb();
  const { refId, ...rest } = parsed.data;
  await prisma.sourcingWatch.upsert({
    where: { refId },
    update: { ...rest, active: true },
    create: { refId, ...rest, active: true },
  });

  revalidate();
  return { ok: true, message: "Référence suivie." };
}

/**
 * Stop watching a reference.
 *
 * Deactivates rather than deletes: the scored candidates already recorded
 * against it stay meaningful, and re-adding it later should not read as a
 * brand-new watch with no history.
 */
export async function deactivateWatchSA(refId: string): Promise<SourcingActionResult> {
  await guard();
  const parsed = z.string().min(1).safeParse(refId);
  if (!parsed.success) return { ok: false, error: "Référence invalide." };

  const prisma = await getTenantDb();
  await prisma.sourcingWatch.update({
    where: { refId: parsed.data },
    data: { active: false },
  });

  revalidate();
  return { ok: true, message: "Suivi désactivé." };
}

/** Dismiss a scored listing so the next scan does not resurface it. */
export async function rejectCandidateSA(candidateId: string): Promise<SourcingActionResult> {
  await guard();
  const parsed = z.string().min(1).safeParse(candidateId);
  if (!parsed.success) return { ok: false, error: "Annonce invalide." };

  const prisma = await getTenantDb();
  await prisma.sourcingCandidate.update({
    where: { id: parsed.data },
    data: { status: "REJECTED" },
  });

  revalidate();
  return { ok: true, message: "Annonce écartée." };
}

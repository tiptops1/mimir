"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession, requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { requireModule } from "@/lib/tenant-profile";
import { deleteEbayIntegration, touchEbayLastSynced } from "@/lib/integrations";
import { forgetAccessToken } from "@/lib/ebay-oauth";
import { ignoreOrder, reconcileOrderToUnit, runChronosSyncForTenant } from "@/lib/chronos/sync";

/**
 * Local result type rather than the shared FormResult: these actions report a
 * success SUMMARY ("12 read, 9 matched"), which FormResult has no slot for, and
 * widening a type with that many call sites for one module's benefit is the
 * wrong trade.
 */
export interface SyncActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Chronos marketplace sync (S29) — write side.
 *
 * Like src/app/actions/chronos.ts, deliberately NOT through the Heimdallr
 * ledger: mirroring a sale that already happened is ingestion, and reconciling
 * an order is an operator's own bookkeeping. Neither is an agent proposing
 * anything. (Kairos's buy offers at S32 DO go through the ledger — that is a
 * side-effectful decision, which is the actual line D5 draws.)
 *
 * Every action is module-gated as well as role-gated: hiding a nav link is not
 * access control.
 */

const idSchema = z.string().min(1);

async function guard() {
  const session = await verifySession();
  await requireRole(["ADMIN", "MANAGER"]);
  await requireModule("chronos");
  return session;
}

function revalidateSync() {
  revalidatePath("/chronos");
  revalidatePath("/chronos/settings");
  revalidatePath("/chronos/reconciliation");
}

/** Pull orders now rather than waiting for the daily cron. */
export async function syncNowSA(): Promise<SyncActionResult> {
  const session = await guard();
  const prisma = await getTenantDb();

  try {
    const result = await runChronosSyncForTenant(prisma, { tenantId: session.tenantId });
    if (result.ordersSeen > 0) await touchEbayLastSynced(session.tenantId);
    revalidateSync();

    if (result.skipped) {
      return { ok: false, error: `Synchronisation ignorée : ${result.skipped}` };
    }
    return {
      ok: true,
      message:
        `${result.ordersSeen} commande(s) lue(s) · ${result.ordersMatched} rapprochée(s) · ` +
        `${result.ordersPending} en attente · ${result.costLinesWritten} ligne(s) de frais`,
    };
  } catch (e) {
    // A marketplace outage or an expired token must not take the page down.
    return { ok: false, error: (e as Error).message };
  }
}

/** Attach a queued order to a unit the operator picked. */
export async function reconcileOrderSA(
  orderId: string,
  unitId: string,
): Promise<SyncActionResult> {
  await guard();
  const prisma = await getTenantDb();

  const parsed = z.object({ orderId: idSchema, unitId: idSchema }).safeParse({ orderId, unitId });
  if (!parsed.success) return { ok: false, error: "Commande ou unité invalide." };

  try {
    const { costLines } = await reconcileOrderToUnit(prisma, parsed.data.orderId, parsed.data.unitId);
    revalidateSync();
    return { ok: true, message: `Rapprochée · ${costLines} ligne(s) de frais imputée(s)` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Park an order that will never map to a unit (a spare part, a duplicate). */
export async function ignoreOrderSA(orderId: string): Promise<SyncActionResult> {
  await guard();
  const prisma = await getTenantDb();

  const parsed = idSchema.safeParse(orderId);
  if (!parsed.success) return { ok: false, error: "Commande invalide." };

  try {
    await ignoreOrder(prisma, parsed.data);
    revalidateSync();
    return { ok: true, message: "Commande ignorée." };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Disconnect eBay. Drops the stored refresh token and the cached access token.
 * Already-synced cost lines stay: they are historical fact, and deleting them
 * would silently rewrite the margin on every sold unit.
 */
export async function disconnectEbaySA(): Promise<SyncActionResult> {
  const session = await guard();
  await deleteEbayIntegration(session.tenantId);
  forgetAccessToken(session.tenantId);
  revalidateSync();
  return { ok: true, message: "Compte eBay déconnecté." };
}

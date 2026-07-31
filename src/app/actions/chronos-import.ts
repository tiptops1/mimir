"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifySession, requireRole } from "@/lib/dal";
import { getTenantDb } from "@/lib/tenant-context";
import { requireModule } from "@/lib/tenant-profile";
import { looksNonUtf8, parseCsvWithHeader, stripBom } from "@/lib/import/csv";
import {
  missingRequiredColumns,
  parseSaleRows,
  suggestSaleMapping,
  SALE_TARGETS,
  type SaleMapping,
} from "@/lib/chronos/sale-import";
import { previewChronosSync, runChronosSyncForTenant } from "@/lib/chronos/sync";

/**
 * Chronos (S29) — manual-marketplace sale import.
 *
 * Upload → map → dry run → apply, for Chrono24 / Vinted / LeBonCoin, which have
 * no API. Applying goes through runChronosSyncForTenant with the parsed orders
 * injected, so a CSV sale lands through exactly the same write path as an eBay
 * one: same fee mapping, same dedupe keys, same reconciliation queue for rows
 * whose SKU we don't recognise.
 *
 * No ImportRun row: idempotency comes from the deterministic dedupe keys and
 * MarketplaceOrder's unique, so re-applying the same file converges rather than
 * duplicating. A run model would track state nothing needs.
 */

/** Same ceiling as the CRM importer — a sale export is a few hundred rows. */
const MAX_CHARS = 4 * 1024 * 1024;

export interface ImportPreviewResult {
  ok: boolean;
  error?: string;
  headers?: string[];
  mapping?: SaleMapping;
  missing?: string[];
  rowErrors?: Array<{ rowNumber: number; message: string }>;
  preview?: Array<{
    externalId: string;
    sku: string | null;
    soldAt: string;
    grossCents: number;
    feeCount: number;
    feeTotalBaseCents: number;
    outcome: "matched" | "pending";
    reason?: string;
  }>;
  matched?: number;
  pending?: number;
}

const inputSchema = z.object({
  text: z.string().min(1).max(MAX_CHARS),
  marketplace: z.string().min(1).max(64),
  mapping: z.record(z.string(), z.string()).optional(),
});

async function guard() {
  const session = await verifySession();
  await requireRole(["ADMIN", "MANAGER"]);
  await requireModule("chronos");
  return session;
}

/**
 * parseCsvWithHeader yields positional rows (string[][]); the sale parser works
 * by header name, so zip them here. Duplicate headers keep the FIRST column —
 * a spreadsheet with two "Montant" columns is ambiguous, and silently taking
 * the last one is the surprising choice.
 */
function readCsv(text: string) {
  const cleaned = stripBom(text);
  if (looksNonUtf8(cleaned)) {
    return {
      error:
        "Le fichier ne semble pas être en UTF-8 (caractères accentués corrompus). " +
        "Ré-exportez-le en UTF-8 puis réessayez.",
    } as const;
  }

  let headers: string[];
  let rawRows: string[][];
  try {
    const parsed = parseCsvWithHeader(cleaned);
    headers = parsed.headers;
    rawRows = parsed.rows;
  } catch (e) {
    // parseCsvWithHeader throws a French message meant to be shown verbatim.
    return { error: (e as Error).message } as const;
  }

  const rows = rawRows.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      if (header && !(header in record)) record[header] = cells[i] ?? "";
    });
    return record;
  });

  return { parsed: { headers, rows } } as const;
}

/** Parse + map + dry-run. Writes nothing. */
export async function previewSaleImportSA(
  text: string,
  marketplace: string,
  mapping?: Record<string, string>,
): Promise<ImportPreviewResult> {
  await guard();
  const prisma = await getTenantDb();

  const input = inputSchema.safeParse({ text, marketplace, mapping });
  if (!input.success) return { ok: false, error: "Fichier ou marketplace invalide." };

  const read = readCsv(input.data.text);
  if ("error" in read) return { ok: false, error: read.error };
  const { headers, rows } = read.parsed;

  const effective: SaleMapping =
    input.data.mapping && Object.keys(input.data.mapping).length > 0
      ? (input.data.mapping as SaleMapping)
      : suggestSaleMapping(headers);

  const missing = missingRequiredColumns(effective);
  if (missing.length > 0) {
    return {
      ok: false,
      headers,
      mapping: effective,
      missing: missing.map((k) => SALE_TARGETS.find((t) => t.key === k)?.label ?? k),
      error: "Colonnes obligatoires non associées.",
    };
  }

  const { orders, errors } = parseSaleRows(rows, effective);
  const preview = await previewChronosSync(prisma, orders, {
    provider: input.data.marketplace,
  });

  return {
    ok: true,
    headers,
    mapping: effective,
    rowErrors: errors,
    matched: preview.matched,
    pending: preview.pending,
    preview: preview.rows.slice(0, 200).map((r) => ({
      ...r,
      soldAt: r.soldAt.toISOString().slice(0, 10),
    })),
  };
}

export interface ImportApplyResult {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Write the sales. Re-running the same file converges — nothing duplicates. */
export async function applySaleImportSA(
  text: string,
  marketplace: string,
  mapping: Record<string, string>,
): Promise<ImportApplyResult> {
  const session = await guard();
  const prisma = await getTenantDb();

  const input = inputSchema.safeParse({ text, marketplace, mapping });
  if (!input.success) return { ok: false, error: "Fichier ou marketplace invalide." };

  const read = readCsv(input.data.text);
  if ("error" in read) return { ok: false, error: read.error };

  const effective = input.data.mapping as SaleMapping;
  if (missingRequiredColumns(effective).length > 0) {
    return { ok: false, error: "Colonnes obligatoires non associées." };
  }

  const { orders, errors } = parseSaleRows(read.parsed.rows, effective);
  if (orders.length === 0) {
    return { ok: false, error: "Aucune ligne exploitable dans ce fichier." };
  }

  try {
    // The eBay path with the fetch swapped out — one write path, not two.
    const result = await runChronosSyncForTenant(prisma, {
      tenantId: session.tenantId,
      provider: input.data.marketplace,
      fetchOrders: async () => orders,
    });

    revalidatePath("/chronos");
    revalidatePath("/chronos/reconciliation");

    const skipped = errors.length > 0 ? ` · ${errors.length} ligne(s) ignorée(s)` : "";
    return {
      ok: true,
      message:
        `${result.ordersMatched} vente(s) imputée(s) · ${result.ordersPending} en attente de ` +
        `rapprochement · ${result.costLinesWritten} ligne(s) de frais${skipped}`,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

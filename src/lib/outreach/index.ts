import { decrypt } from "@/lib/crypto";
import { getTenantPrisma } from "@/lib/tenant-db";
import { authedClientForOutreach, authedClientForTenant } from "@/lib/google-oauth";
import { settle, type SourceOutcome } from "@/lib/tenant-cron";
import { runOutreachSend, type SendRunReport } from "./send-engine";
import { runOutreachReplySync } from "./reply-sync";

// Per-tenant outreach tick, called hourly (business hours) by
// /api/cron/outreach — deliberately separate from the 4h ingestion cron so
// send pacing and stop-on-reply latency don't depend on the heavy sync loop.
// Order matters: replies are ingested BEFORE sending, so a prospect who
// answered an hour ago can't receive the next step of the sequence.

export interface OutreachTenantReport {
  tenant: string;
  replies: SourceOutcome;
  send: SourceOutcome;
}

interface TenantRow {
  id: string;
  slug: string;
  connectionString: string;
}

export async function runOutreachForTenant(
  tenant: TenantRow,
): Promise<OutreachTenantReport> {
  const prisma = getTenantPrisma(decrypt(tenant.connectionString));
  const outreach = await authedClientForOutreach(tenant.id);

  if (!outreach) {
    const idle: SourceOutcome = {
      source: "outreach",
      ok: true,
      result: "Boîte d'envoi OUTREACH non connectée",
    };
    return { tenant: tenant.slug, replies: idle, send: idle };
  }

  const main = await authedClientForTenant(tenant.id);
  const replies = await settle("outreach-replies", () =>
    runOutreachReplySync(prisma, outreach, main),
  );
  const send = await settle("outreach-send", () =>
    runOutreachSend(prisma, tenant.id, outreach),
  );
  return { tenant: tenant.slug, replies, send };
}

export type { SendRunReport };

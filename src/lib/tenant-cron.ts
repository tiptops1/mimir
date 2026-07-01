import { controlPrisma } from "@/lib/control-db";
import { decrypt } from "@/lib/crypto";
import { getTenantPrisma } from "@/lib/tenant-db";
import { authedClientForTenant } from "@/lib/google-oauth";
import { getFirefliesKey, touchGoogleLastSynced } from "@/lib/integrations";
import { runImapSync } from "@/lib/imap-sync";
import { runGmailSync } from "@/lib/gmail-sync";
import { syncCalendar } from "@/lib/calendar-sync";
import { runGoogleCalendarSync } from "@/lib/google-calendar-sync";
import { syncFireflies } from "@/lib/fireflies";
import { enrichActivities, aiEnabled } from "@/lib/ai-extract";
import { advanceSequences } from "@/lib/sequences";
import { advanceFinanceAlerts } from "@/lib/finance-alerts";
import { sendDailyDigest } from "@/lib/digest";

// Phase 3: the per-tenant ingestion loop. For each ACTIVE tenant, resolve its
// data DB through the control plane, its Google connection (OAuth) and its
// Fireflies key (encrypted Integration rows), then run every pipeline stage.
// The legacy env-based fallbacks (IMAP / ICS / FIREFLIES_API_KEY / OWNER_EMAIL)
// apply ONLY to tenant #1 — they are Christopher's pre-multi-tenant setup and
// must never leak another tenant's ingestion into his mailbox.

const tenant1Slug = () => process.env.TENANT1_SLUG || "crm_chris";

export interface SourceOutcome {
  source: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export async function settle(
  label: string,
  fn: () => Promise<unknown>,
): Promise<SourceOutcome> {
  try {
    return { source: label, ok: true, result: await fn() };
  } catch (e) {
    return { source: label, ok: false, error: (e as Error).message };
  }
}

export interface TenantCronReport {
  tenant: string;
  sources: SourceOutcome[];
  ai: SourceOutcome;
  sequences: SourceOutcome;
  financeAlerts: SourceOutcome;
  digest: SourceOutcome;
}

interface TenantRow {
  id: string;
  slug: string;
  connectionString: string;
}

/** "prenom.nom@x" → "Prenom Nom" for the digest greeting of non-#1 tenants. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(" ") || email
  );
}

export async function runCronForTenant(
  tenant: TenantRow,
): Promise<TenantCronReport> {
  const prisma = getTenantPrisma(decrypt(tenant.connectionString));
  const isTenant1 = tenant.slug === tenant1Slug();
  const google = await authedClientForTenant(tenant.id);

  const sources: SourceOutcome[] = [];
  if (google) {
    sources.push(
      await settle("email", () =>
        runGmailSync(prisma, google.client, google.accountEmail, {}),
      ),
      await settle("calendar", () =>
        runGoogleCalendarSync(prisma, google.client, google.accountEmail, {}),
      ),
    );
  } else if (isTenant1) {
    // Christopher's pre-OAuth setup: IMAP app password + secret iCal URL.
    sources.push(
      await settle("email", () => runImapSync(prisma, {})),
      await settle("calendar", () => syncCalendar(prisma, {})),
    );
  } else {
    sources.push(
      { source: "email", ok: false, error: "Google non connecté" },
      { source: "calendar", ok: false, error: "Google non connecté" },
    );
  }

  const firefliesKey =
    (await getFirefliesKey(tenant.id)) ??
    (isTenant1 ? process.env.FIREFLIES_API_KEY : undefined);
  sources.push(
    firefliesKey
      ? await settle("fireflies", () =>
          syncFireflies(prisma, {
            apiKey: firefliesKey,
            ownerEmail: google?.accountEmail,
          }),
        )
      : { source: "fireflies", ok: false, error: "Clé Fireflies non configurée" },
  );

  if (google) await touchGoogleLastSynced(tenant.id);

  const ai = aiEnabled()
    ? await settle("ai-insight", () => enrichActivities(prisma, { limit: 80 }))
    : {
        source: "ai-insight",
        ok: false,
        error: "no GEMINI_API_KEY or ANTHROPIC_API_KEY",
      };

  const sequences = await settle("sequences", () => advanceSequences(prisma));
  const financeAlerts = await settle("finance-alerts", () =>
    advanceFinanceAlerts(prisma),
  );
  const digest = await settle("digest", () =>
    sendDailyDigest(prisma, {
      google,
      // Tenant #1 keeps the configured greeting; others derive one from the
      // connected account until owner-name becomes tenant config.
      ownerName:
        !isTenant1 && google ? nameFromEmail(google.accountEmail) : undefined,
    }),
  );

  return { tenant: tenant.slug, sources, ai, sequences, financeAlerts, digest };
}

/** Every ACTIVE tenant, in a stable order — the cron loop's worklist. */
export async function listActiveTenants(): Promise<TenantRow[]> {
  return controlPrisma.tenant.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, connectionString: true },
  });
}

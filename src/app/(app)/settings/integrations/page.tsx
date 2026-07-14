import { verifySession } from "@/lib/dal";
import {
  getGoogleConnection,
  getFirefliesConnection,
} from "@/lib/integrations";
import { ConnectGmailCta } from "@/components/connect-gmail-cta";
import { ConnectOutreachCta } from "@/components/connect-outreach-cta";
import { FirefliesCard } from "@/components/fireflies-card";
import { formatDate } from "@/lib/utils";

// Phase 3 self-serve integrations: each tenant connects its own sources here.
// Google = OAuth (same flow as the dashboard CTA); Fireflies = pasted API key,
// encrypted in the control plane. The cron loop picks both up per tenant.
// The OUTREACH card is the SECOND Google connection — the cold-email sender
// inbox the outreach engine sends from (never the main mailbox).

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ outreach?: string }>;
}) {
  const session = await verifySession();
  const [google, outreach, fireflies, params] = await Promise.all([
    getGoogleConnection(session.tenantId),
    getGoogleConnection(session.tenantId, "OUTREACH"),
    getFirefliesConnection(session.tenantId),
    searchParams,
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted">
        Connectez vos sources : les emails, réunions et comptes-rendus d&apos;appels
        se rattachent automatiquement à vos contacts à chaque synchronisation.
      </p>
      {params.outreach === "error" && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          La connexion de la boîte d&apos;envoi a échoué. Réessayez, ou vérifiez que
          le compte autorise bien l&apos;accès Gmail.
        </p>
      )}
      <ConnectGmailCta
        connected={Boolean(google)}
        accountEmail={google?.accountEmail ?? null}
        lastSyncLabel={google?.lastSyncedAt ? formatDate(google.lastSyncedAt) : null}
      />
      <ConnectOutreachCta
        connected={Boolean(outreach)}
        accountEmail={outreach?.accountEmail ?? null}
      />
      <FirefliesCard
        connected={Boolean(fireflies)}
        lastSyncLabel={
          fireflies?.lastSyncedAt ? formatDate(fireflies.lastSyncedAt) : null
        }
      />
    </div>
  );
}

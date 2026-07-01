import { verifySession } from "@/lib/dal";
import {
  getGoogleConnection,
  getFirefliesConnection,
} from "@/lib/integrations";
import { ConnectGmailCta } from "@/components/connect-gmail-cta";
import { FirefliesCard } from "@/components/fireflies-card";
import { formatDate } from "@/lib/utils";

// Phase 3 self-serve integrations: each tenant connects its own sources here.
// Google = OAuth (same flow as the dashboard CTA); Fireflies = pasted API key,
// encrypted in the control plane. The cron loop picks both up per tenant.

export default async function IntegrationsSettingsPage() {
  const session = await verifySession();
  const [google, fireflies] = await Promise.all([
    getGoogleConnection(session.tenantId),
    getFirefliesConnection(session.tenantId),
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted">
        Connectez vos sources : les emails, réunions et comptes-rendus d&apos;appels
        se rattachent automatiquement à vos contacts à chaque synchronisation.
      </p>
      <ConnectGmailCta
        connected={Boolean(google)}
        accountEmail={google?.accountEmail ?? null}
        lastSyncLabel={google?.lastSyncedAt ? formatDate(google.lastSyncedAt) : null}
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

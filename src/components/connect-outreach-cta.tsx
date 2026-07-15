"use client";

import { useTransition } from "react";
import { Send, Check, RefreshCw } from "lucide-react";
import { disconnectOutreachGoogle } from "@/app/actions/integrations";

// Settings card for the OUTREACH Google connection — the cold-email sender
// inbox on a secondary domain (e.g. outreach@votredomaine.com). Same one-click
// OAuth as the main card, but lands in the OUTREACH slot (?purpose=OUTREACH)
// so the ingestion sync never touches it and the send engine never picks the
// main mailbox by mistake.

export function ConnectOutreachCta({
  connected,
  accountEmail,
}: {
  connected: boolean;
  accountEmail: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        connected
          ? "border-emerald-200 bg-emerald-50"
          : "border-amber-200 bg-gradient-to-r from-amber-50 to-background"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            connected ? "bg-emerald-100" : "bg-amber-100"
          }`}
        >
          {connected ? (
            <Check className="h-5 w-5 text-emerald-600" />
          ) : (
            <Send className="h-5 w-5 text-amber-600" />
          )}
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {connected
              ? "Boîte d'envoi cold email connectée"
              : "Connectez la boîte d'envoi cold email"}
          </p>
          <p className="text-sm text-muted">
            {connected ? (
              <>{accountEmail} · utilisée uniquement par le moteur Outreach</>
            ) : (
              <>
                La boîte du domaine secondaire (ex. outreach@votredomaine.com)
                — jamais votre adresse principale. Les séquences d&apos;emails
                partent d&apos;ici.
              </>
            )}
          </p>
        </div>
      </div>

      {connected ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => void disconnectOutreachGoogle())}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {pending && <RefreshCw className="h-4 w-4 animate-spin" />}
          Déconnecter
        </button>
      ) : (
        <a
          href="/api/integrations/google/connect?purpose=OUTREACH"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
        >
          <Send className="h-4 w-4" />
          Connecter la boîte d&apos;envoi
        </a>
      )}
    </div>
  );
}

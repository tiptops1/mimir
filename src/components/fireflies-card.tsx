"use client";

import { useActionState, useTransition } from "react";
import { Check, Mic, RefreshCw } from "lucide-react";
import {
  saveFirefliesKey,
  disconnectFireflies,
  type IntegrationResult,
} from "@/app/actions/integrations";
import { Button, Input, Label } from "@/components/ui";

// Settings card for the Fireflies.ai connection: paste an API key (stored
// encrypted in the control plane) or disconnect. Mirrors the Google card's
// connected/disconnected states.

export function FirefliesCard({
  connected,
  lastSyncLabel,
}: {
  connected: boolean;
  lastSyncLabel: string | null;
}) {
  const [state, formAction, pending] = useActionState<
    IntegrationResult | undefined,
    FormData
  >(saveFirefliesKey, undefined);
  const [disconnecting, startTransition] = useTransition();

  return (
    <div
      className={`rounded-xl border p-4 ${
        connected
          ? "border-emerald-200 bg-emerald-50"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            connected ? "bg-emerald-100" : "bg-surface-2"
          }`}
        >
          {connected ? (
            <Check className="h-5 w-5 text-emerald-600" />
          ) : (
            <Mic className="h-5 w-5 text-muted" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {connected ? "Fireflies.ai connecté" : "Fireflies.ai"}
          </p>
          <p className="text-sm text-muted">
            {connected
              ? lastSyncLabel
                ? `Dernière synchro : ${lastSyncLabel}`
                : "En attente de la première synchro"
              : "Vos comptes-rendus d'appels se rattachent automatiquement à vos contacts. Collez votre clé API Fireflies (Paramètres → API dans Fireflies)."}
          </p>

          {connected ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                disabled={disconnecting}
                onClick={() =>
                  startTransition(async () => {
                    await disconnectFireflies();
                  })
                }
              >
                {disconnecting && (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                )}
                Déconnecter
              </Button>
            </div>
          ) : (
            <form action={formAction} className="mt-3 space-y-2">
              <div className="max-w-md">
                <Label htmlFor="apiKey">Clé API Fireflies</Label>
                <Input
                  id="apiKey"
                  name="apiKey"
                  type="password"
                  placeholder="ff_xxxxxxxxxxxxxxxx"
                  autoComplete="off"
                  required
                />
              </div>
              {state?.error ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {state.error}
                </p>
              ) : null}
              <Button type="submit" disabled={pending}>
                {pending ? "Enregistrement…" : "Connecter Fireflies"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

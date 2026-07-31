"use client";

import { useState, useTransition } from "react";
import { Unplug } from "lucide-react";
import { Button, LinkButton } from "@/components/ui";
import { disconnectGoogleSA } from "@/app/actions/integrations";

/**
 * Connect / disconnect controls for the Google mailbox, twin of EbayActions.
 *
 * There is no "sync now" here on purpose: Gmail ingestion runs on the shared
 * /api/cron sweep across every tenant, not a per-tenant trigger like eBay's.
 */
export function GoogleActions({ connected }: { connected: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!connected) {
    return (
      <LinkButton href="/api/integrations/google/connect" size="sm">
        Connecter Google
      </LinkButton>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setResult(null);
          startTransition(async () => {
            const r = await disconnectGoogleSA();
            setResult({ ok: r.ok, text: r.ok ? (r.message ?? "Terminé.") : (r.error ?? "Échec.") });
          });
        }}
      >
        <Unplug className="h-4 w-4" />
        Déconnecter
      </Button>
      {result ? (
        <p className={`text-xs ${result.ok ? "text-success" : "text-danger"}`}>{result.text}</p>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Unplug } from "lucide-react";
import { Button, LinkButton } from "@/components/ui";
import { disconnectEbaySA, syncNowSA } from "@/app/actions/chronos-sync";

/**
 * Connect / sync / disconnect controls for the eBay integration.
 *
 * Client-side only for the pending states and the result line; every decision
 * stays in the server actions. Mirrors the shape of ConnectGmailCta on
 * /settings/integrations.
 */
export function EbayActions({ connected }: { connected: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setResult(null);
    startTransition(async () => {
      const r = await action();
      setResult({ ok: r.ok, text: r.ok ? (r.message ?? "Terminé.") : (r.error ?? "Échec.") });
    });
  }

  if (!connected) {
    return (
      <LinkButton href="/api/integrations/ebay/connect" size="sm">
        Connecter eBay
      </LinkButton>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => run(syncNowSA)}
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Synchronisation…" : "Synchroniser maintenant"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(disconnectEbaySA)}
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

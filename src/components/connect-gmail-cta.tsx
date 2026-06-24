"use client";

import { useTransition } from "react";
import { Mail, Check, Calendar, RefreshCw } from "lucide-react";
import { disconnectGoogle } from "@/app/(app)/dashboard/integration-actions";

// Dashboard card for the Google (Gmail + Calendar) connection. One-click OAuth —
// the "Connecter Google" button is just a link to the connect route, which
// bounces to Google's consent screen. When connected we show the real account
// and a disconnect button. (Replaces the old manual IMAP App-Password walkthrough.)

export function ConnectGmailCta({
  connected,
  accountEmail,
  lastSyncLabel,
}: {
  connected: boolean;
  accountEmail: string | null;
  lastSyncLabel: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        connected
          ? "border-emerald-200 bg-emerald-50"
          : "border-indigo-200 bg-gradient-to-r from-indigo-50 to-white"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            connected ? "bg-emerald-100" : "bg-indigo-100"
          }`}
        >
          {connected ? (
            <Check className="h-5 w-5 text-emerald-600" />
          ) : (
            <Mail className="h-5 w-5 text-brand" />
          )}
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">
            {connected ? "Compte Google connecté" : "Connectez votre compte Google"}
          </p>
          <p className="text-sm text-muted">
            {connected ? (
              <>
                {accountEmail}
                {" · "}
                {lastSyncLabel
                  ? `Dernière synchro : ${lastSyncLabel}`
                  : "En attente de la première synchro"}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Gmail
                <Calendar className="ml-1.5 h-3.5 w-3.5" /> Agenda — un clic, et
                emails &amp; réunions se rattachent à vos contacts.
              </span>
            )}
          </p>
        </div>
      </div>

      {connected ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => disconnectGoogle())}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {pending && <RefreshCw className="h-4 w-4 animate-spin" />}
          Déconnecter
        </button>
      ) : (
        <a
          href="/api/integrations/google/connect"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          <Mail className="h-4 w-4" />
          Connecter Google
        </a>
      )}
    </div>
  );
}

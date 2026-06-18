"use client";

import { useState } from "react";
import { Mail, Check, X, ExternalLink } from "lucide-react";

const STEPS = [
  {
    title: "Activer la validation en 2 étapes",
    body: "Sur le compte Google Ctoppo@avelior.eu : Sécurité → Validation en deux étapes.",
  },
  {
    title: "Créer un mot de passe d'application",
    body: "Type « Mail ». Google génère un code de 16 caractères — c'est lui qu'on utilise (jamais le vrai mot de passe).",
    link: {
      href: "https://myaccount.google.com/apppasswords",
      label: "Ouvrir les mots de passe d'application",
    },
  },
  {
    title: "Activer IMAP dans Gmail",
    body: "Gmail → Paramètres → Transfert et POP/IMAP → Activer IMAP. (Côté Admin Workspace, autoriser IMAP et les mots de passe d'application.)",
  },
  {
    title: "Renseigner les variables sur Railway",
    body: "IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD (le mot de passe d'application), OWNER_EMAIL.",
  },
  {
    title: "Lancer la synchronisation",
    body: "npm run sync:email (ou un service cron Railway toutes les ~5 min). Les emails se rattachent alors aux contacts automatiquement.",
  },
];

export function ConnectGmailCta({
  connected,
  lastSyncLabel,
}: {
  connected: boolean;
  lastSyncLabel: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
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
              {connected
                ? "Boîte mail connectée"
                : "Connectez la boîte mail de Christopher"}
            </p>
            <p className="text-sm text-muted">
              {connected
                ? `Dernière synchronisation : ${lastSyncLabel ?? "—"}`
                : "Liez Gmail pour journaliser automatiquement les emails échangés avec vos contacts."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            connected
              ? "border border-border bg-white text-foreground hover:bg-slate-50"
              : "bg-brand text-white hover:bg-indigo-700"
          }`}
        >
          <Mail className="h-4 w-4" />
          {connected ? "Gérer la connexion" : "Connecter Gmail"}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Connecter Gmail au CRM</h2>
                <p className="text-sm text-muted">
                  Connexion sécurisée par mot de passe d&apos;application (IMAP),
                  gratuite. Le mot de passe reste sur Railway — l&apos;app ne le
                  voit jamais.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fermer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <ol className="space-y-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-brand">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium">{s.title}</p>
                    <p className="text-sm text-muted">{s.body}</p>
                    {s.link && (
                      <a
                        href={s.link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm text-brand hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        {s.link.label}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
              Une fois lancée, la première synchro ne récupère que les nouveaux
              emails (ajoutez <code>--backfill=200</code> pour importer
              l&apos;historique récent). Les expéditeurs inconnus arrivent dans
              la « Boîte de réception » à valider.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

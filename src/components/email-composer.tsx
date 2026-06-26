"use client";

import { useActionState, useState, useTransition } from "react";
import { Mail, Sparkles, Send, X, FileSearch } from "lucide-react";
import { Button, Input, Label, Textarea } from "@/components/ui";
import { generateEmailDraft, sendEmail, type SendResult } from "@/app/actions/email";

// Per-contact email composer on the company fiche: open a panel, optionally
// AI-generate a researched draft, edit, and send via the connected Gmail account.

export function EmailComposer({
  companyId,
  contactId,
  contactLabel,
  defaultTo,
  googleConnected,
  googleEmail,
}: {
  companyId: string;
  contactId: string;
  contactLabel: string;
  defaultTo: string;
  googleConnected: boolean;
  googleEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [genError, setGenError] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();

  const [state, formAction, sending] = useActionState<SendResult | undefined, FormData>(
    async (prev, fd) => sendEmail(prev, fd),
    undefined,
  );

  function generate() {
    setGenError(null);
    startGenerate(async () => {
      const res = await generateEmailDraft(companyId, contactId);
      if (res.ok) {
        setSubject(res.subject ?? "");
        setBody(res.body ?? "");
        setSources(res.sources ?? []);
      } else {
        setGenError(res.error ?? "Génération impossible.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-brand hover:underline"
      >
        <Mail className="h-3.5 w-3.5" />
        Email
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-lg border border-border bg-surface-2/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">
          Email à {contactLabel}
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-faint hover:text-foreground"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {state?.ok ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Email envoyé et ajouté à l&apos;historique.
        </p>
      ) : (
        <form action={formAction} className="space-y-2.5">
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="contactId" value={contactId} />

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={generate}
              disabled={generating}
              className="text-brand"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "Recherche & rédaction…" : "Générer avec IA"}
            </Button>
            <span className="text-[11px] text-muted">
              {googleConnected ? (
                <>Depuis {googleEmail ?? "Google"}</>
              ) : (
                <a href="/dashboard" className="text-brand hover:underline">
                  Google non connecté — connecter
                </a>
              )}
            </span>
          </div>

          {genError ? <p className="text-sm text-rose-700">{genError}</p> : null}

          {sources.length > 0 && (
            <div className="rounded-md border border-indigo-100 bg-indigo-50/50 px-2.5 py-2 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1 font-medium text-brand">
                <FileSearch className="h-3.5 w-3.5" /> Sources consultées
              </span>
              : {sources.join(" · ")}
            </div>
          )}

          <div>
            <Label htmlFor={`to-${contactId}`}>Destinataire</Label>
            <Input
              id={`to-${contactId}`}
              name="to"
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="prenom.nom@societe.fr"
            />
          </div>
          <div>
            <Label htmlFor={`subject-${contactId}`}>Objet</Label>
            <Input
              id={`subject-${contactId}`}
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`body-${contactId}`}>Message</Label>
            <Textarea
              id={`body-${contactId}`}
              name="body"
              rows={9}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {state?.error ? (
            <p className="text-sm text-rose-700">{state.error}</p>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={sending || !googleConnected}>
              <Send className="h-4 w-4" />
              {sending ? "Envoi…" : "Envoyer"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

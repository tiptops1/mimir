"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui";
import {
  approveActionSA,
  approveEditedActionSA,
  rejectActionSA,
} from "@/app/actions/heimdallr";

type Source = { docId?: string; chunkId?: string; quote?: string; score?: number };
type Trigger = { kind?: string; [key: string]: unknown };
type DraftPayload = { to?: string; subject?: string; body?: string; inReplyTo?: string };
type RcaSection = { key: string; label: string; content: string | null };
type RcaPayload = { templateKey?: string; templateVersion?: number; sections?: RcaSection[] };
type ContentPayload = {
  channel?: string;
  periodKey?: string;
  topic?: string;
  title?: string;
  body?: string;
};
type DirectivePayload = {
  key?: string;
  scope?: string;
  module?: string | null;
  category?: string | null;
  objective?: string;
  constraints?: Record<string, unknown> | null;
  mode?: string;
};
type RenewalSignal = { key: string; label: string; detail: string };
type RenewalPayload = {
  companyName?: string;
  band?: string;
  score?: number;
  signals?: RenewalSignal[];
  subject?: string;
  body?: string;
};
type LegalPayload = {
  docType?: string;
  companyId?: string;
  companyName?: string;
  title?: string;
  body?: string;
  inputText?: string;
};

const DRAFT_TYPE = "email.draft_reply";
const RCA_TYPE = "doc.rca_draft";
const CONTENT_TYPE = "content.draft";
const DIRECTIVE_TYPE = "directive.set";
const RENEWAL_TYPE = "renewal.outreach_draft";
const LEGAL_TYPE = "forseti.legal_document_draft";

export function HeimdallrActionRow({
  id,
  type,
  payload,
  sources,
  trigger,
}: {
  id: string;
  type: string;
  payload: unknown;
  sources: unknown;
  trigger: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const isDraft = type === DRAFT_TYPE && payload !== null && typeof payload === "object";
  const draft = isDraft ? (payload as DraftPayload) : null;

  const isRca = type === RCA_TYPE && payload !== null && typeof payload === "object";
  const rca = isRca ? (payload as RcaPayload) : null;
  const rcaSections = rca?.sections ?? [];

  const isContent = type === CONTENT_TYPE && payload !== null && typeof payload === "object";
  const content = isContent ? (payload as ContentPayload) : null;

  const isDirective = type === DIRECTIVE_TYPE && payload !== null && typeof payload === "object";
  const directive = isDirective ? (payload as DirectivePayload) : null;

  const isRenewal = type === RENEWAL_TYPE && payload !== null && typeof payload === "object";
  const renewal = isRenewal ? (payload as RenewalPayload) : null;

  const isLegal = type === LEGAL_TYPE && payload !== null && typeof payload === "object";
  const legal = isLegal ? (payload as LegalPayload) : null;

  const [editedPayload, setEditedPayload] = useState(() => JSON.stringify(payload, null, 2));
  const [editedSubject, setEditedSubject] = useState(draft?.subject ?? "");
  const [editedBody, setEditedBody] = useState(draft?.body ?? "");
  const [editedTitle, setEditedTitle] = useState(content?.title ?? "");
  const [editedContentBody, setEditedContentBody] = useState(content?.body ?? "");
  const [editedObjective, setEditedObjective] = useState(directive?.objective ?? "");
  const [editedRenewalSubject, setEditedRenewalSubject] = useState(renewal?.subject ?? "");
  const [editedRenewalBody, setEditedRenewalBody] = useState(renewal?.body ?? "");
  const [editedLegalTitle, setEditedLegalTitle] = useState(legal?.title ?? "");
  const [editedLegalBody, setEditedLegalBody] = useState(legal?.body ?? "");
  const [editedSections, setEditedSections] = useState<Record<string, string>>(() =>
    Object.fromEntries(rcaSections.map((s) => [s.key, s.content ?? ""])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sourceList = Array.isArray(sources) ? (sources as Source[]) : [];
  const triggerObj = (trigger ?? null) as Trigger | null;

  const runAction = (action: () => Promise<string | null>) =>
    startTransition(async () => {
      setError(null);
      const err = await action();
      if (err) setError(err);
    });

  const submitEdited = () =>
    startTransition(async () => {
      setError(null);
      const parsed = draft
        ? { ...draft, subject: editedSubject, body: editedBody }
        : content
          ? { ...content, title: editedTitle, body: editedContentBody }
        : directive
          ? { ...directive, objective: editedObjective }
        : renewal
          ? { ...renewal, subject: editedRenewalSubject, body: editedRenewalBody }
        : legal
          ? { ...legal, title: editedLegalTitle, body: editedLegalBody }
        : rca
          ? {
              ...rca,
              sections: rcaSections.map((s) => ({
                ...s,
                content: editedSections[s.key] ?? s.content,
              })),
            }
          : (() => {
              try {
                return JSON.parse(editedPayload);
              } catch {
                return undefined;
              }
            })();
      if (parsed === undefined) {
        setError("JSON invalide.");
        return;
      }
      const err = await approveEditedActionSA(id, parsed);
      if (err) setError(err);
      else setEditing(false);
    });

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 self-end text-xs font-medium text-muted hover:text-foreground"
      >
        {open ? "Réduire" : "Détails"}
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="w-full max-w-xl rounded-lg border border-border bg-surface-2 p-3 text-left text-xs">
          <p className="mb-1 font-medium text-foreground">Contenu proposé</p>
          {draft ? (
            <div className="space-y-1.5 rounded-md bg-card p-2 text-[11px] text-muted">
              <p>
                <span className="font-medium text-foreground">À : </span>
                {draft.to ?? "—"}
              </p>
              <p>
                <span className="font-medium text-foreground">Objet : </span>
                {draft.subject ?? "—"}
              </p>
              <div>
                <span className="font-medium text-foreground">Corps : </span>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                  {draft.body ?? "—"}
                </pre>
              </div>
            </div>
          ) : content ? (
            <div className="space-y-1.5 rounded-md bg-card p-2 text-[11px] text-muted">
              <p>
                <span className="font-medium text-foreground">Canal : </span>
                {content.channel ?? "—"}
                {content.periodKey ? ` · ${content.periodKey}` : null}
              </p>
              <p>
                <span className="font-medium text-foreground">Sujet : </span>
                {content.topic ?? "—"}
              </p>
              <p>
                <span className="font-medium text-foreground">Titre : </span>
                {content.title ?? "—"}
              </p>
              <div>
                <span className="font-medium text-foreground">Corps : </span>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                  {content.body ?? "—"}
                </pre>
              </div>
            </div>
          ) : directive ? (
            <div className="space-y-1.5 rounded-md bg-card p-2 text-[11px] text-muted">
              <p>
                <span className="font-medium text-foreground">Clé : </span>
                {directive.key ?? "—"}
                {directive.mode ? ` · ${directive.mode}` : null}
              </p>
              <p>
                <span className="font-medium text-foreground">Portée : </span>
                {directive.scope ?? "—"}
                {directive.module ? ` (${directive.module})` : ""}
                {directive.category ? ` (${directive.category})` : ""}
              </p>
              <div>
                <span className="font-medium text-foreground">Objectif : </span>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                  {directive.objective ?? "—"}
                </pre>
              </div>
              {directive.constraints && (
                <div>
                  <span className="font-medium text-foreground">Contraintes : </span>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                    {JSON.stringify(directive.constraints, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : renewal ? (
            <div className="space-y-1.5 rounded-md bg-card p-2 text-[11px] text-muted">
              <p>
                <span className="font-medium text-foreground">Société : </span>
                {renewal.companyName ?? "—"}
              </p>
              <p>
                <span className="font-medium text-foreground">Score : </span>
                {typeof renewal.score === "number" ? renewal.score : "—"}
                {renewal.band ? ` · ${renewal.band}` : ""}
              </p>
              {renewal.signals && renewal.signals.length > 0 && (
                <div>
                  <span className="font-medium text-foreground">Signaux : </span>
                  <ul className="mt-1 list-disc pl-4">
                    {renewal.signals.map((s) => (
                      <li key={s.key}>{s.label}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p>
                <span className="font-medium text-foreground">Objet : </span>
                {renewal.subject ?? "—"}
              </p>
              <div>
                <span className="font-medium text-foreground">Corps : </span>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                  {renewal.body ?? "—"}
                </pre>
              </div>
            </div>
          ) : legal ? (
            <div className="space-y-1.5 rounded-md bg-card p-2 text-[11px] text-muted">
              <p>
                <span className="font-medium text-foreground">Société : </span>
                {legal.companyName ?? "—"}
              </p>
              <p>
                <span className="font-medium text-foreground">Type : </span>
                {legal.docType === "contract_review"
                  ? "Revue de contrat"
                  : legal.docType === "terms_draft"
                    ? "Rédaction de conditions"
                    : (legal.docType ?? "—")}
              </p>
              <p>
                <span className="font-medium text-foreground">Titre : </span>
                {legal.title ?? "—"}
              </p>
              <div>
                <span className="font-medium text-foreground">Corps : </span>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                  {legal.body ?? "—"}
                </pre>
              </div>
            </div>
          ) : rca ? (
            <div className="space-y-2">
              {rcaSections.map((s) => (
                <div key={s.key} className="rounded-md bg-card p-2 text-[11px] text-muted">
                  <span className="font-medium text-foreground">{s.label}</span>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-muted">
                    {s.content ?? "(échec de génération pour cette section)"}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <pre className="max-h-48 overflow-auto rounded-md bg-card p-2 text-[11px] text-muted">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}

          {sourceList.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 font-medium text-foreground">Sources</p>
              <ul className="space-y-1">
                {sourceList.map((s, i) => (
                  <li key={i} className="rounded-md bg-card p-2 text-muted">
                    <span className="line-clamp-2">{s.quote ?? "—"}</span>
                    {typeof s.score === "number" && (
                      <span className="ml-1 text-faint">({s.score.toFixed(2)})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {triggerObj && (
            <p className="mt-2 text-muted">
              <span className="font-medium text-foreground">Déclencheur : </span>
              {triggerObj.kind ?? "—"}
            </p>
          )}
        </div>
      )}

      {editing && (
        <div className="flex w-full max-w-xl flex-col gap-2">
          {draft ? (
            <>
              <Input
                value={editedSubject}
                onChange={(e) => setEditedSubject(e.target.value)}
                disabled={pending}
                placeholder="Objet"
              />
              <Textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                disabled={pending}
                rows={6}
              />
            </>
          ) : content ? (
            <>
              <Input
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                disabled={pending}
                placeholder="Titre"
              />
              <Textarea
                value={editedContentBody}
                onChange={(e) => setEditedContentBody(e.target.value)}
                disabled={pending}
                rows={8}
              />
            </>
          ) : directive ? (
            <Textarea
              value={editedObjective}
              onChange={(e) => setEditedObjective(e.target.value)}
              disabled={pending}
              rows={4}
              placeholder="Objectif"
            />
          ) : renewal ? (
            <>
              <Input
                value={editedRenewalSubject}
                onChange={(e) => setEditedRenewalSubject(e.target.value)}
                disabled={pending}
                placeholder="Objet"
              />
              <Textarea
                value={editedRenewalBody}
                onChange={(e) => setEditedRenewalBody(e.target.value)}
                disabled={pending}
                rows={6}
              />
            </>
          ) : legal ? (
            <>
              <Input
                value={editedLegalTitle}
                onChange={(e) => setEditedLegalTitle(e.target.value)}
                disabled={pending}
                placeholder="Titre"
              />
              <Textarea
                value={editedLegalBody}
                onChange={(e) => setEditedLegalBody(e.target.value)}
                disabled={pending}
                rows={8}
              />
            </>
          ) : rca ? (
            <>
              {rcaSections.map((s) => (
                <div key={s.key} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted">{s.label}</label>
                  <Textarea
                    value={editedSections[s.key] ?? ""}
                    onChange={(e) =>
                      setEditedSections((prev) => ({ ...prev, [s.key]: e.target.value }))
                    }
                    disabled={pending}
                    rows={3}
                  />
                </div>
              ))}
            </>
          ) : (
            <Textarea
              value={editedPayload}
              onChange={(e) => setEditedPayload(e.target.value)}
              disabled={pending}
              rows={6}
              className="font-mono text-xs"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Annuler
            </Button>
            <Button type="button" size="sm" disabled={pending} onClick={submitEdited}>
              Enregistrer et approuver
            </Button>
          </div>
        </div>
      )}

      {!editing && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => runAction(() => approveActionSA(id))}
          >
            Approuver
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            Modifier puis approuver
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() => runAction(() => rejectActionSA(id))}
          >
            Rejeter
          </Button>
        </div>
      )}

      {error && <p className="self-end text-xs text-danger">{error}</p>}
    </div>
  );
}

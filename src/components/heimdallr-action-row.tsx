"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import {
  approveActionSA,
  approveEditedActionSA,
  rejectActionSA,
} from "@/app/actions/heimdallr";

type Source = { docId?: string; chunkId?: string; quote?: string; score?: number };
type Trigger = { kind?: string; [key: string]: unknown };

export function HeimdallrActionRow({
  id,
  payload,
  sources,
  trigger,
}: {
  id: string;
  payload: unknown;
  sources: unknown;
  trigger: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedPayload, setEditedPayload] = useState(() => JSON.stringify(payload, null, 2));
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(editedPayload);
      } catch {
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
          <pre className="max-h-48 overflow-auto rounded-md bg-card p-2 text-[11px] text-muted">
            {JSON.stringify(payload, null, 2)}
          </pre>

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
          <Textarea
            value={editedPayload}
            onChange={(e) => setEditedPayload(e.target.value)}
            disabled={pending}
            rows={6}
            className="font-mono text-xs"
          />
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

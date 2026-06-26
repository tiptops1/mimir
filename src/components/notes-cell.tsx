"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setCompanyNotes } from "@/app/actions/companies";

export function NotesCell({
  id,
  value,
}: {
  id: string;
  value: string | null;
}) {
  const [notes, setNotes] = useState(value ?? "");
  const [draft, setDraft] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) taRef.current?.focus();
  }, [editing]);

  function save() {
    const next = draft.trim();
    setNotes(next);
    setEditing(false);
    startTransition(() => setCompanyNotes(id, next));
  }

  function cancel() {
    setDraft(notes);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="w-60">
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            if (e.key === "Escape") cancel();
          }}
          rows={3}
          placeholder="Notes ou prochaines étapes…"
          className="w-full resize-none rounded-lg border border-border bg-white px-2 py-1.5 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-indigo-100"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Enregistrer
          </button>
          <button
            type="button"
            onClick={cancel}
            className="text-xs text-muted hover:text-foreground"
          >
            Annuler
          </button>
          <span className="ml-auto text-[10px] text-faint">⌘↵</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={pending}
      className="group flex w-60 items-start gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-surface-2 disabled:opacity-50"
    >
      {notes ? (
        <span className="line-clamp-3 whitespace-pre-wrap text-xs text-foreground">
          {notes}
        </span>
      ) : (
        <span className="text-xs text-faint">+ Ajouter une note</span>
      )}
      <span className="ml-auto hidden shrink-0 text-[10px] text-brand group-hover:inline">
        ✎
      </span>
    </button>
  );
}

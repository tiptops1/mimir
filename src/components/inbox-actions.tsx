"use client";

import { useState, useTransition } from "react";
import { Check, X, ListPlus, Ban } from "lucide-react";
import {
  approvePending,
  dismissPending,
  createTaskFromPending,
  markPendingSpam,
} from "@/app/actions/inbox";
import { Button } from "@/components/ui";

const TASK_TYPES: { value: string; label: string }[] = [
  { value: "EMAIL", label: "Email" },
  { value: "RELANCE", label: "Relance" },
  { value: "APPEL", label: "Appel" },
  { value: "RDV", label: "Rendez-vous" },
  { value: "AUTRE", label: "Autre" },
];

export function PendingRow({
  id,
  domain,
  defaultTitle,
  companies,
}: {
  id: string;
  domain: string;
  defaultTitle: string;
  companies: { id: string; name: string }[];
}) {
  const [companyId, setCompanyId] = useState("__new__");
  const [showTask, setShowTask] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [type, setType] = useState("EMAIL");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selectClass =
    "max-w-56 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-50";

  const submitTask = () =>
    startTransition(async () => {
      setError(null);
      const err = await createTaskFromPending(id, companyId, {
        title,
        type,
        dueDate: dueDate || null,
      });
      if (err) setError(err);
      else setShowTask(false);
    });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          disabled={pending}
          className={selectClass}
        >
          <option value="__new__">➕ Nouvelle société « {domain} »</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => approvePending(id, companyId))}
          className="px-2.5 py-1.5 text-xs"
        >
          <Check className="h-3.5 w-3.5" /> Approuver
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setShowTask((v) => !v)}
          className="px-2.5 py-1.5 text-xs"
        >
          <ListPlus className="h-3.5 w-3.5" /> Tâche
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => startTransition(() => dismissPending(id))}
          className="px-2.5 py-1.5 text-xs"
        >
          <X className="h-3.5 w-3.5" /> Ignorer
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => startTransition(() => markPendingSpam(id))}
          title="Bloque l'adresse et le domaine — n'apparaîtra plus jamais"
          className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
        >
          <Ban className="h-3.5 w-3.5" /> Spam
        </Button>
      </div>

      {showTask && (
        <div className="flex w-full max-w-md flex-col gap-2 rounded-lg border border-border bg-slate-50 p-3">
          <p className="text-xs text-muted">
            Crée le contact (société ci-dessus) et une tâche de suivi.
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending}
            placeholder="Intitulé de la tâche…"
            className="w-full rounded-md border border-border bg-white px-2 py-1.5 text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={pending}
              className="rounded-md border border-border bg-white px-2 py-1.5 text-xs text-slate-700"
            >
              {TASK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={pending}
              className="rounded-md border border-border bg-white px-2 py-1.5 text-xs text-slate-700"
            />
            <Button
              type="button"
              disabled={pending || !title.trim()}
              onClick={submitTask}
              className="px-2.5 py-1.5 text-xs"
            >
              Créer la tâche
            </Button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

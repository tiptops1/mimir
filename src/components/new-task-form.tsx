"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { createTask } from "@/app/actions/tasks";
import type { FormResult } from "@/app/actions/companies";
import { Button, Input, Label, Select } from "@/components/ui";
import { TASK_TYPES } from "@/lib/constants";

export interface TaskCompanyOption {
  id: string;
  name: string;
}

/**
 * Quick-add a task. When `companyId` is fixed (company detail page) the picker
 * is hidden; otherwise the user picks a company via a datalist (name → id).
 */
export function NewTaskForm({
  companyId,
  companies,
  onDone,
  compact = false,
}: {
  companyId?: string;
  companies?: TaskCompanyOption[];
  onDone?: () => void;
  compact?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [companyName, setCompanyName] = useState("");
  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(async (prev, fd) => {
    const res = await createTask(prev, fd);
    if (res.ok) {
      formRef.current?.reset();
      setCompanyName("");
      onDone?.();
    }
    return res;
  }, undefined);

  // Resolve the typed company name back to an id for submission.
  const byName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of companies ?? []) m.set(c.name.toLowerCase(), c.id);
    return m;
  }, [companies]);
  const resolvedCompanyId = companyId ?? byName.get(companyName.trim().toLowerCase()) ?? "";

  return (
    <form
      ref={formRef}
      action={formAction}
      className={compact ? "space-y-2" : "space-y-3 rounded-lg border border-border p-4"}
    >
      <input type="hidden" name="companyId" value={resolvedCompanyId} />

      {!companyId && (
        <div>
          <Label htmlFor="task-company">Société</Label>
          <Input
            id="task-company"
            list="task-company-list"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Rechercher une société…"
            autoComplete="off"
          />
          <datalist id="task-company-list">
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </div>
      )}

      <div>
        <Label htmlFor="task-title">Intitulé</Label>
        <Input
          id="task-title"
          name="title"
          placeholder="Ex. : Relancer par téléphone"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="task-type">Type</Label>
          <Select id="task-type" name="type" defaultValue="RELANCE">
            {TASK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="task-due">Échéance</Label>
          <Input id="task-due" name="dueDate" type="date" />
        </div>
      </div>

      {state?.error ? (
        <p className="text-sm text-rose-700">{state.error}</p>
      ) : null}

      <Button type="submit" disabled={pending || !resolvedCompanyId}>
        {pending ? "Ajout…" : "Ajouter la tâche"}
      </Button>
    </form>
  );
}

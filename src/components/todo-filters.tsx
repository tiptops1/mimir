"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { useUrlFilters } from "@/lib/use-url-filters";
import { TASK_TYPES } from "@/lib/constants";

/** Live filter bar for À faire (/todo) — narrows the open tasks as you type/select. */
export function TodoFilters() {
  const f = useUrlFilters();
  const [q, setQ] = useState(f.get("q"));
  const [societe, setSociete] = useState(f.get("societe"));

  const hasFilters = Boolean(q || societe || f.get("type") || f.get("source"));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-44 flex-1">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            f.setDebounced("q", e.target.value);
          }}
          placeholder="Intitulé de la tâche…"
        />
      </div>
      <div className="min-w-40 flex-1">
        <Input
          value={societe}
          onChange={(e) => {
            setSociete(e.target.value);
            f.setDebounced("societe", e.target.value);
          }}
          placeholder="Société…"
        />
      </div>
      <Select
        value={f.get("type")}
        onChange={(e) => f.setNow("type", e.target.value)}
        className="w-44"
      >
        <option value="">Tous les types</option>
        {TASK_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("source")}
        onChange={(e) => f.setNow("source", e.target.value)}
        className="w-48"
      >
        <option value="">Toutes origines</option>
        <option value="MANUAL">Manuelles</option>
        <option value="AI_NEXTSTEP">Suggérées par l&apos;IA</option>
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            setSociete("");
            f.reset();
          }}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-foreground"
        >
          Réinitialiser
        </button>
      )}
    </div>
  );
}

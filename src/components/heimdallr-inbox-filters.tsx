"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { useUrlFilters } from "@/lib/use-url-filters";

const MODULES = [
  { value: "heimdallr", label: "Heimdallr" },
  { value: "mimisbrunnr", label: "Mímisbrunnr" },
  { value: "huginn", label: "Huginn" },
  { value: "muninn", label: "Muninn" },
  { value: "nornir", label: "Nornir" },
  { value: "bragi", label: "Bragi" },
  { value: "forseti", label: "Forseti" },
  { value: "system", label: "Système" },
];

/** Live filter bar for the approval inbox — mirrors InboxFilters. */
export function HeimdallrInboxFilters({
  categories,
}: {
  categories: { value: string; label: string }[];
}) {
  const f = useUrlFilters();
  const [q, setQ] = useState(f.get("q"));

  const hasFilters = Boolean(q || f.get("category") || f.get("module"));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-44 flex-1">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            f.setDebounced("q", e.target.value);
          }}
          placeholder="Type ou entité…"
        />
      </div>
      <Select
        value={f.get("category")}
        onChange={(e) => f.setNow("category", e.target.value)}
        className="w-56"
      >
        <option value="">Toutes les catégories</option>
        {categories.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("module")}
        onChange={(e) => f.setNow("module", e.target.value)}
        className="w-44"
      >
        <option value="">Tous les modules</option>
        {MODULES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setQ("");
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

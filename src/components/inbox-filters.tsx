"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { useUrlFilters } from "@/lib/use-url-filters";

/** Live filter bar for the inbox queue — mirrors the Contacts/Suivi filters. */
export function InboxFilters() {
  const f = useUrlFilters();
  const [q, setQ] = useState(f.get("q"));
  const [min, setMin] = useState(f.get("min"));

  const hasFilters = Boolean(q || min || f.get("dir") || f.get("seen"));

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-44 flex-1">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            f.setDebounced("q", e.target.value);
          }}
          placeholder="Expéditeur, email ou sujet…"
        />
      </div>
      <Select
        value={f.get("dir")}
        onChange={(e) => f.setNow("dir", e.target.value)}
        className="w-48"
      >
        <option value="">Reçus &amp; envoyés</option>
        <option value="INBOUND">Reçus uniquement</option>
        <option value="OUTBOUND">Envoyés uniquement</option>
      </Select>
      <div className="w-44">
        <Input
          type="number"
          min={1}
          value={min}
          onChange={(e) => {
            setMin(e.target.value);
            f.setDebounced("min", e.target.value);
          }}
          placeholder="Min. messages…"
        />
      </div>
      <Select
        value={f.get("seen")}
        onChange={(e) => f.setNow("seen", e.target.value)}
        className="w-44"
      >
        <option value="">Vu : toute période</option>
        <option value="7">Vu depuis 7 jours</option>
        <option value="30">Vu depuis 30 jours</option>
        <option value="90">Vu depuis 90 jours</option>
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            setMin("");
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

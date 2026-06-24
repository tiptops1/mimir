"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { useUrlFilters } from "@/lib/use-url-filters";
import {
  PIPELINE_STAGES,
  PRIORITE_OPTIONS,
  POTENTIEL_OPTIONS,
  CANAL_PREFERE_OPTIONS,
  SPECIALTY_FIELDS,
} from "@/lib/constants";

/** Live filter bar for Suivi (/companies) — narrows the list as you type/select. */
export function CompaniesFilters() {
  const f = useUrlFilters();
  // Free-text fields are local state for smooth typing; the URL updates debounced.
  // The three text filters combine (AND) with each other and with the selects.
  const [societe, setSociete] = useState(f.get("societe"));
  const [nom, setNom] = useState(f.get("nom"));
  const [contact, setContact] = useState(f.get("contact"));

  const hasFilters = Boolean(
    societe ||
      nom ||
      contact ||
      f.get("stage") ||
      f.get("priorite") ||
      f.get("potentiel") ||
      f.get("canal") ||
      f.get("site") ||
      f.get("specialite") ||
      f.get("dept"),
  );

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-40 flex-1">
        <Input
          value={nom}
          onChange={(e) => {
            setNom(e.target.value);
            f.setDebounced("nom", e.target.value);
          }}
          placeholder="Nom du contact…"
        />
      </div>
      <div className="min-w-44 flex-1">
        <Input
          value={societe}
          onChange={(e) => {
            setSociete(e.target.value);
            f.setDebounced("societe", e.target.value);
          }}
          placeholder="Société…"
        />
      </div>
      <div className="min-w-40 flex-1">
        <Input
          value={contact}
          onChange={(e) => {
            setContact(e.target.value);
            f.setDebounced("contact", e.target.value);
          }}
          placeholder="Email / téléphone…"
        />
      </div>
      <Select
        value={f.get("stage")}
        onChange={(e) => f.setNow("stage", e.target.value)}
        className="w-52"
      >
        <option value="">Toutes les étapes</option>
        {PIPELINE_STAGES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("priorite")}
        onChange={(e) => f.setNow("priorite", e.target.value)}
        className="w-44"
      >
        <option value="">Toutes priorités</option>
        {PRIORITE_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("potentiel")}
        onChange={(e) => f.setNow("potentiel", e.target.value)}
        className="w-40"
      >
        <option value="">Tout potentiel</option>
        {POTENTIEL_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("canal")}
        onChange={(e) => f.setNow("canal", e.target.value)}
        className="w-44"
      >
        <option value="">Tout canal</option>
        {CANAL_PREFERE_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("specialite")}
        onChange={(e) => f.setNow("specialite", e.target.value)}
        className="w-44"
      >
        <option value="">Toutes spécialités</option>
        {SPECIALTY_FIELDS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("site")}
        onChange={(e) => f.setNow("site", e.target.value)}
        className="w-40"
      >
        <option value="">Site web : tous</option>
        <option value="with">Avec site web</option>
        <option value="without">Sans site web</option>
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setSociete("");
            setNom("");
            setContact("");
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

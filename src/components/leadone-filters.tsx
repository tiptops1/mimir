"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { useUrlFilters } from "@/lib/use-url-filters";

interface SpecialtyOption {
  value: string;
  label: string;
}

/** Live filter bar for the /leadone review queue — narrows as you type/select. */
export function LeadOneFilters({
  specialtyOptions,
}: {
  specialtyOptions: SpecialtyOption[];
}) {
  const f = useUrlFilters();
  const [contact, setContact] = useState(f.get("contact"));
  const [societe, setSociete] = useState(f.get("societe"));
  const [email, setEmail] = useState(f.get("email"));

  const hasFilters = Boolean(
    contact ||
      societe ||
      email ||
      f.get("siteweb") ||
      f.get("telephone") ||
      f.get("linkedin") ||
      f.get("specialite") ||
      f.get("score"),
  );

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-40 flex-1">
        <Input
          value={contact}
          onChange={(e) => {
            setContact(e.target.value);
            f.setDebounced("contact", e.target.value);
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
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            f.setDebounced("email", e.target.value);
          }}
          placeholder="Email…"
        />
      </div>
      <Select
        value={f.get("siteweb")}
        onChange={(e) => f.setNow("siteweb", e.target.value)}
        className="w-40"
      >
        <option value="">Site web : tous</option>
        <option value="with">Avec site web</option>
        <option value="without">Sans site web</option>
      </Select>
      <Select
        value={f.get("telephone")}
        onChange={(e) => f.setNow("telephone", e.target.value)}
        className="w-44"
      >
        <option value="">Téléphone : tous</option>
        <option value="with">Avec téléphone</option>
        <option value="without">Sans téléphone</option>
      </Select>
      <Select
        value={f.get("linkedin")}
        onChange={(e) => f.setNow("linkedin", e.target.value)}
        className="w-44"
      >
        <option value="">LinkedIn : tous</option>
        <option value="verified">Vérifié</option>
        <option value="unverified">Non vérifié</option>
      </Select>
      <Select
        value={f.get("specialite")}
        onChange={(e) => f.setNow("specialite", e.target.value)}
        className="w-44"
      >
        <option value="">Toutes spécialités</option>
        {specialtyOptions.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("score")}
        onChange={(e) => f.setNow("score", e.target.value)}
        className="w-44"
      >
        <option value="">Score : tous</option>
        <option value="80">≥ 80 (fiable)</option>
        <option value="60">≥ 60 (correct)</option>
        <option value="low">&lt; 60 (à vérifier)</option>
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setContact("");
            setSociete("");
            setEmail("");
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

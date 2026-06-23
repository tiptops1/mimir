"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { useUrlFilters } from "@/lib/use-url-filters";

/** Live filter bar for Contacts — narrows the list as you type/select. */
export function ContactsFilters() {
  const f = useUrlFilters();
  // Three combinable text filters (AND) alongside the dropdowns.
  const [societe, setSociete] = useState(f.get("societe"));
  const [nom, setNom] = useState(f.get("nom"));
  const [contact, setContact] = useState(f.get("contact"));

  const hasFilters = Boolean(
    societe || nom || contact || f.get("role") || f.get("has") || f.get("site"),
  );

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-44 flex-1">
        <Input
          value={nom}
          onChange={(e) => {
            setNom(e.target.value);
            f.setDebounced("nom", e.target.value);
          }}
          placeholder="Nom du contact…"
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
        value={f.get("role")}
        onChange={(e) => f.setNow("role", e.target.value)}
        className="w-48"
      >
        <option value="">Tous les contacts</option>
        <option value="decideur">Décideurs uniquement</option>
      </Select>
      <Select
        value={f.get("has")}
        onChange={(e) => f.setNow("has", e.target.value)}
        className="w-48"
      >
        <option value="">Toutes coordonnées</option>
        <option value="email">Avec email</option>
        <option value="phone">Avec téléphone</option>
        <option value="linkedin">Avec LinkedIn</option>
      </Select>
      <Select
        value={f.get("site")}
        onChange={(e) => f.setNow("site", e.target.value)}
        className="w-48"
      >
        <option value="">Site web : tous</option>
        <option value="with">Société avec site</option>
        <option value="without">Société sans site</option>
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

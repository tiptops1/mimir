"use client";

import { useState } from "react";
import { Input, Select } from "@/components/ui";
import { useUrlFilters } from "@/lib/use-url-filters";
import { UNIT_SORTS } from "@/lib/chronos/list";
// Client-safe stage type — unit-stage-config.ts is server-only (it resolves the
// tenant DB), and importing it from here is the classic build break.
import type { UnitStageDef } from "@/lib/chronos/unit-stage-meta";

/**
 * Filter bar for the Chronos inventory. Identity-first, per CLAUDE.md's field
 * order law: the CRM's "contact name, company, email" maps onto a unit's own
 * identity chain — its SKU, its catalog reference, its serial — before any
 * qualification filter.
 *
 * The last two selects (marge, tri) are DERIVED: they can't be pushed into the
 * Prisma query, and the page post-filters on them. See src/lib/chronos/list.ts.
 */
export function UnitFilters({
  stages,
  marketplaces,
}: {
  stages: UnitStageDef[];
  marketplaces: { key: string; label: string }[];
}) {
  const f = useUrlFilters();
  const [sku, setSku] = useState(f.get("sku"));
  const [ref, setRef] = useState(f.get("ref"));
  const [serie, setSerie] = useState(f.get("serie"));
  const [fournisseur, setFournisseur] = useState(f.get("fournisseur"));

  const hasFilters = Boolean(
    sku ||
      ref ||
      serie ||
      fournisseur ||
      f.get("statut") ||
      f.get("dispo") ||
      f.get("canal") ||
      f.get("marge") ||
      f.get("age") ||
      f.get("tri"),
  );

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div className="min-w-40 flex-1">
        <Input
          value={sku}
          onChange={(e) => {
            setSku(e.target.value);
            f.setDebounced("sku", e.target.value);
          }}
          placeholder="SKU…"
        />
      </div>
      <div className="min-w-44 flex-1">
        <Input
          value={ref}
          onChange={(e) => {
            setRef(e.target.value);
            f.setDebounced("ref", e.target.value);
          }}
          placeholder="Marque / référence…"
        />
      </div>
      <div className="min-w-40 flex-1">
        <Input
          value={serie}
          onChange={(e) => {
            setSerie(e.target.value);
            f.setDebounced("serie", e.target.value);
          }}
          placeholder="N° de série…"
        />
      </div>
      <Select
        value={f.get("statut")}
        onChange={(e) => f.setNow("statut", e.target.value)}
        className="w-44"
      >
        <option value="">Tous les statuts</option>
        {stages.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      <Select
        value={f.get("dispo")}
        onChange={(e) => f.setNow("dispo", e.target.value)}
        className="w-40"
      >
        <option value="">Stock et ventes</option>
        <option value="stock">En stock</option>
        <option value="vendue">Vendues</option>
      </Select>
      <Select
        value={f.get("canal")}
        onChange={(e) => f.setNow("canal", e.target.value)}
        className="w-44"
      >
        <option value="">Toutes marketplaces</option>
        {marketplaces.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </Select>
      <div className="min-w-40 flex-1">
        <Input
          value={fournisseur}
          onChange={(e) => {
            setFournisseur(e.target.value);
            f.setDebounced("fournisseur", e.target.value);
          }}
          placeholder="Fournisseur…"
        />
      </div>
      <Select
        value={f.get("marge")}
        onChange={(e) => f.setNow("marge", e.target.value)}
        className="w-48"
      >
        <option value="">Toutes les marges</option>
        <option value="perte">Ventes à perte</option>
        <option value="sousObjectif">Sous l&apos;objectif</option>
      </Select>
      <Select
        value={f.get("age")}
        onChange={(e) => f.setNow("age", e.target.value)}
        className="w-48"
      >
        <option value="">Toute ancienneté</option>
        <option value="0-30">En stock &lt; 30 j</option>
        <option value="30-90">En stock 30-90 j</option>
        <option value="90+">En stock &gt; 90 j</option>
      </Select>
      <Select
        value={f.get("tri")}
        onChange={(e) => f.setNow("tri", e.target.value)}
        className="w-52"
      >
        {UNIT_SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            Tri : {s.label}
          </option>
        ))}
      </Select>
      {hasFilters && (
        <button
          type="button"
          onClick={() => {
            setSku("");
            setRef("");
            setSerie("");
            setFournisseur("");
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

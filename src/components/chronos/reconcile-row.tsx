"use client";

import { useState, useTransition } from "react";
import { Button, Select } from "@/components/ui";
import { ignoreOrderSA, reconcileOrderSA } from "@/app/actions/chronos-sync";

export interface UnitOption {
  id: string;
  sku: string;
  label: string;
}

/**
 * One queued order: pick the unit it belongs to, or park it.
 *
 * The unit list is deliberately restricted to UNSOLD units by the page — an
 * order can only be the sale of something still in stock, and offering every
 * unit would make the wrong choice as easy as the right one.
 */
export function ReconcileControls({
  orderId,
  units,
}: {
  orderId: string;
  units: UnitOption[];
}) {
  const [unitId, setUnitId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply() {
    if (!unitId) return;
    setError(null);
    startTransition(async () => {
      const r = await reconcileOrderSA(orderId, unitId);
      if (!r.ok) setError(r.error ?? "Échec du rapprochement.");
    });
  }

  function park() {
    setError(null);
    startTransition(async () => {
      const r = await ignoreOrderSA(orderId);
      if (!r.ok) setError(r.error ?? "Échec.");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Unité à rapprocher"
        value={unitId}
        disabled={pending || units.length === 0}
        onChange={(e) => setUnitId(e.target.value)}
        className="min-w-0 max-w-full sm:w-64"
      >
        <option value="">
          {units.length === 0 ? "Aucune unité en stock" : "Choisir une unité…"}
        </option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </Select>
      <Button size="sm" disabled={pending || !unitId} onClick={apply}>
        {pending ? "…" : "Rapprocher"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={park}>
        Ignorer
      </Button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

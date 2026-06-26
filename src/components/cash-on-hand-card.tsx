"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { setCashOnHand } from "@/app/actions/finances";
import { formatCurrency } from "@/lib/display";
import { Input } from "@/components/ui";

// 4th cockpit KPI: editable trésorerie (cash on hand) + derived runway.
// Runway = cash ÷ monthly net burn, shown only when the business is burning.
export function CashOnHandCard({
  cash,
  monthlyNet,
}: {
  cash: number | null;
  monthlyNet: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cash != null ? String(cash) : "");
  const [pending, startTransition] = useTransition();

  function save() {
    setEditing(false);
    startTransition(() => setCashOnHand(value));
  }

  const burn = monthlyNet < 0 ? -monthlyNet : 0;
  const runwayMonths = cash != null && burn > 0 ? Math.floor(cash / burn) : null;

  const runwayLabel =
    cash == null
      ? "Ajoutez votre trésorerie"
      : monthlyNet >= 0
        ? "Rentable ce mois"
        : runwayMonths != null
          ? `${runwayMonths} mois d'autonomie`
          : "—";

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <p className="text-xs text-muted">Trésorerie · autonomie</p>
      {editing ? (
        <Input
          autoFocus
          type="number"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="Montant en banque"
          className="mt-1 h-9"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={pending}
          className="mt-0.5 flex items-center gap-1.5 text-2xl font-semibold hover:text-brand disabled:opacity-50"
        >
          {cash != null ? formatCurrency(cash) : "—"}
          <Pencil className="h-3.5 w-3.5 text-faint" />
        </button>
      )}
      <p
        className={`mt-0.5 text-xs ${
          monthlyNet < 0 && runwayMonths != null && runwayMonths < 6
            ? "text-rose-600"
            : "text-muted"
        }`}
      >
        {runwayLabel}
      </p>
    </div>
  );
}

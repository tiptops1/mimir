"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { addUnitCostLine, deleteUnitCostLine } from "@/app/actions/chronos";
import { COST_KIND_OPTIONS, costKindLabel } from "@/lib/chronos/cost-meta";
import { formatCents } from "@/lib/display";
import { formatDate } from "@/lib/utils";
import type { FormResult } from "@/app/actions/companies";

export interface CostLineRow {
  id: string;
  kind: string;
  label: string;
  amountCents: number;
  currency: string;
  fxRate: number;
  baseAmountCents: number;
  incurredAt: Date;
  source: string;
}

/**
 * The unit's cost ledger, plus the inline add form.
 *
 * Only MANUAL lines offer a delete: a marketplace-synced fee or a part-lot
 * draw-down is someone else's record of truth, and removing it by hand would
 * put the unit permanently out of step with the statement it reconciles
 * against. The server action refuses those too — this just doesn't offer it.
 */
function DeleteLineButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => deleteUnitCostLine(id))}
      aria-label="Supprimer la ligne"
      className="rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-danger disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

export function UnitCostsCard({
  unitId,
  lines,
}: {
  unitId: string;
  lines: CostLineRow[];
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(async (prev, fd) => {
    const res = await addUnitCostLine(prev, fd);
    if (res.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
    return res;
  }, undefined);

  return (
    <div className="space-y-4">
      {lines.length === 0 ? (
        <p className="text-sm text-muted">Aucune ligne de coût.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/60 text-left text-[11px] uppercase tracking-wider text-faint">
                <th className="px-4 py-2.5 font-semibold">Type</th>
                <th className="px-4 py-2.5 font-semibold">Libellé</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 text-right font-semibold">Montant</th>
                <th className="w-10 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr
                  key={l.id}
                  className="border-b border-border last:border-0 transition-colors hover:bg-surface-2/70"
                >
                  <td className="px-4 py-3">
                    <Badge tone="neutral">{costKindLabel(l.kind)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-foreground">{l.label || "—"}</span>
                    {l.source !== "MANUAL" && (
                      <span className="mt-0.5 block text-xs text-faint">
                        {l.source}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs tnum text-muted">
                    {formatDate(l.incurredAt)}
                  </td>
                  <td className="px-4 py-3 text-right tnum">
                    <span className="text-foreground">
                      {formatCents(l.baseAmountCents)}
                    </span>
                    {l.currency !== "EUR" && (
                      <span className="mt-0.5 block text-xs text-faint">
                        {formatCents(l.amountCents, l.currency)} × {l.fxRate}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.source === "MANUAL" && <DeleteLineButton id={l.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open ? (
        <form
          ref={formRef}
          action={formAction}
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <input type="hidden" name="unitId" value={unitId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="uc-kind">Type</Label>
              <Select id="uc-kind" name="kind" defaultValue="PART">
                {COST_KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="uc-label">Libellé</Label>
              <Input id="uc-label" name="label" placeholder="Joint de couronne" />
            </div>
            <div>
              <Label htmlFor="uc-amount">Montant</Label>
              <Input
                id="uc-amount"
                name="amount"
                inputMode="decimal"
                placeholder="12,50"
                required
              />
            </div>
            <div>
              <Label htmlFor="uc-currency">Devise</Label>
              <Input id="uc-currency" name="currency" defaultValue="EUR" />
            </div>
            <div>
              <Label htmlFor="uc-fx">Taux de change</Label>
              <Input id="uc-fx" name="fxRate" inputMode="decimal" placeholder="1" />
            </div>
            <div>
              <Label htmlFor="uc-date">Date</Label>
              <Input id="uc-date" name="incurredAt" type="date" />
            </div>
          </div>
          {state?.error ? (
            <p className="text-sm text-danger">{state.error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Ajout…" : "Ajouter la ligne"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Ajouter un coût
        </Button>
      )}
    </div>
  );
}

"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import {
  createDeal,
  setDealStage,
  deleteDeal,
  type DealFormResult,
} from "@/app/actions/deals";
import type { StageDef } from "@/lib/stage-meta";

export interface DealRow {
  id: string;
  title: string;
  stage: string;
  product: string | null;
  amount: number | null;
  status: string;
  isPrimary: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-sky-100 text-sky-700",
  WON: "bg-emerald-100 text-emerald-700",
  LOST: "bg-rose-100 text-rose-700",
};
const STATUS_LABEL: Record<string, string> = {
  OPEN: "En cours",
  WON: "Gagnée",
  LOST: "Perdue",
};

function fmtAmount(a: number | null): string | null {
  if (a == null) return null;
  return `${a.toLocaleString("fr-FR")} €`;
}

function DealItem({
  deal,
  companyId,
  stages,
}: {
  deal: DealRow;
  companyId: string;
  stages: StageDef[];
}) {
  const [pending, start] = useTransition();
  const amount = fmtAmount(deal.amount);
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{deal.title}</p>
          {deal.isPrimary && (
            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
              Principale
            </span>
          )}
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              STATUS_STYLE[deal.status] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {STATUS_LABEL[deal.status] ?? deal.status}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          {deal.product && <span>{deal.product}</span>}
          {amount && <span className="font-medium">{amount}</span>}
        </div>
        <div className="mt-2">
          <Select
            value={deal.stage}
            disabled={pending}
            onChange={(e) =>
              start(async () => {
                await setDealStage(deal.id, companyId, e.target.value);
              })
            }
            className="h-8 w-52 py-1 text-xs"
          >
            {stages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {!deal.isPrimary && (
        <form
          action={() => start(async () => { await deleteDeal(deal.id, companyId); })}
          onSubmit={(e) => {
            if (!confirm("Supprimer cette affaire ?")) e.preventDefault();
          }}
        >
          <button
            type="submit"
            className="text-slate-400 transition-colors hover:text-rose-600"
            aria-label="Supprimer l'affaire"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </form>
      )}
    </div>
  );
}

export function DealsCard({
  companyId,
  deals,
  stages,
}: {
  companyId: string;
  deals: DealRow[];
  stages: StageDef[];
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<
    DealFormResult | undefined,
    FormData
  >(async (prev, fd) => {
    const res = await createDeal(prev, fd);
    if (res.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
    return res;
  }, undefined);

  return (
    <div className="space-y-3">
      {deals.length === 0 ? (
        <p className="text-sm text-muted">Aucune affaire.</p>
      ) : (
        deals.map((d) => (
          <DealItem key={d.id} deal={d} companyId={companyId} stages={stages} />
        ))
      )}

      {open ? (
        <form
          ref={formRef}
          action={formAction}
          className="space-y-3 rounded-lg border border-border p-4"
        >
          <input type="hidden" name="companyId" value={companyId} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="deal-title">Intitulé</Label>
              <Input id="deal-title" name="title" placeholder="Opportunité" />
            </div>
            <div>
              <Label htmlFor="deal-product">Produit</Label>
              <Input id="deal-product" name="product" placeholder="Santé, Prévoyance…" />
            </div>
            <div>
              <Label htmlFor="deal-amount">Montant estimé (€)</Label>
              <Input id="deal-amount" name="amount" inputMode="numeric" placeholder="5000" />
            </div>
            <div>
              <Label htmlFor="deal-stage">Étape</Label>
              <Select id="deal-stage" name="stage" defaultValue={stages[0]?.value}>
                {stages.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {state?.error ? (
            <p className="text-sm text-rose-700">{state.error}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Ajout…" : "Enregistrer l'affaire"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          + Nouvelle affaire
        </Button>
      )}
    </div>
  );
}

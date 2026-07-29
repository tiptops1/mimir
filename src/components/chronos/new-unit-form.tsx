"use client";

import { useActionState, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, CardBody, Input, Label } from "@/components/ui";
import { createUnit } from "@/app/actions/chronos";
import type { FormResult } from "@/app/actions/companies";

/**
 * Toggle-to-inline-form for adding a unit, the deals-card.tsx pattern.
 *
 * On success createUnit redirects to the new unit, so there's no reset/close
 * branch here — the page is gone by then.
 */
export function NewUnitForm() {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(async (prev, fd) => createUnit(prev, fd), undefined);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Nouvelle pièce
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardBody>
        <form ref={formRef} action={formAction} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="nu-sku">SKU *</Label>
              <Input id="nu-sku" name="sku" placeholder="WCH-0031" required />
            </div>
            <div>
              <Label htmlFor="nu-brand">Marque *</Label>
              <Input id="nu-brand" name="brand" placeholder="Seiko" required />
            </div>
            <div>
              <Label htmlFor="nu-reference">Référence *</Label>
              <Input id="nu-reference" name="reference" placeholder="SKX007" required />
            </div>
            <div>
              <Label htmlFor="nu-variant">Variante</Label>
              <Input id="nu-variant" name="variant" placeholder="J1" />
            </div>
            <div>
              <Label htmlFor="nu-serial">N° de série</Label>
              <Input id="nu-serial" name="serial" />
            </div>
            <div>
              <Label htmlFor="nu-condition">État</Label>
              <Input id="nu-condition" name="condition" placeholder="Bon état" />
            </div>
            <div>
              <Label htmlFor="nu-price">Prix d&apos;achat (€)</Label>
              <Input
                id="nu-price"
                name="acquisitionPrice"
                inputMode="decimal"
                placeholder="250,00"
              />
            </div>
            <div>
              <Label htmlFor="nu-acquiredAt">Date d&apos;acquisition</Label>
              <Input id="nu-acquiredAt" name="acquiredAt" type="date" />
            </div>
            <div>
              <Label htmlFor="nu-via">Canal d&apos;achat</Label>
              <Input id="nu-via" name="acquiredVia" placeholder="ebay, salon…" />
            </div>
            <div>
              <Label htmlFor="nu-supplier">Fournisseur</Label>
              <Input id="nu-supplier" name="supplier" />
            </div>
          </div>
          {state?.error ? (
            <p className="text-sm text-danger">{state.error}</p>
          ) : (
            <p className="text-xs text-muted">
              Le prix d&apos;achat est enregistré comme ligne de coût
              &laquo;&nbsp;Achat&nbsp;&raquo;.
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Création…" : "Créer la pièce"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

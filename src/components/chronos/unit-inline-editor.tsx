"use client";

import { useActionState, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { updateUnit } from "@/app/actions/chronos";
import type { FormResult } from "@/app/actions/companies";
import type { FieldDef } from "@/lib/field-config";
import {
  NativeFieldControl,
  nativeFieldDefaultValue,
} from "@/components/native-field-control";
import { VAT_SCHEME_OPTIONS } from "@/lib/chronos/cost-meta";
import type { Marketplace } from "@/lib/chronos/config";

/**
 * Unit detail editor, mirroring company-inline-editor.tsx: click a field, edit,
 * the save bar appears only once something changed.
 *
 * Identité and Acquisition are config-driven (NATIVE FieldDefinitions for
 * INVENTORY_UNIT, seeded in default-config.ts) so the operator can relabel
 * "SKU" into their own vocabulary. The Vente block is deliberately hand-built:
 * price is cents, the FX rate is a float multiplier and the VAT scheme is an
 * allow-list — none of which FieldDefinition.type can express.
 */

const editCls =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-foreground transition-colors hover:bg-surface-2 focus:border-brand focus:bg-card focus:outline-none focus:ring-1 focus:ring-brand-subtle";
const selectCls =
  "w-full rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand-subtle";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-xs text-muted">{label}</label>
      {children}
    </div>
  );
}

export interface UnitEditorValues {
  id: string;
  listedAt: string;
  soldAt: string;
  soldOn: string;
  /** Already divided into major units for display — the action re-parses it. */
  salePrice: string;
  saleCurrency: string;
  saleFxRate: string;
  vatScheme: string;
  notes: string;
}

export function UnitInlineEditor({
  unit,
  values,
  nativeDefs,
  marketplaces,
  tenantVatScheme,
}: {
  unit: Record<string, unknown>;
  values: UnitEditorValues;
  nativeDefs: FieldDef[];
  marketplaces: Marketplace[];
  tenantVatScheme: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const bySection = (name: string) =>
    nativeDefs.filter((d) => d.section === name).sort((a, b) => a.order - b.order);

  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(async (prev, fd) => {
    const res = await updateUnit(values.id, prev, fd);
    if (res.ok) setDirty(false);
    return res;
  }, undefined);

  const tenantSchemeLabel =
    VAT_SCHEME_OPTIONS.find((o) => o.value === tenantVatScheme)?.label ??
    tenantVatScheme;

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Identité</CardTitle>
            <span className="text-xs text-muted">
              Cliquez sur un champ pour le modifier
            </span>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {bySection("Identité").map((def) => (
                <Field
                  key={def.key}
                  label={`${def.label}${def.required ? " *" : ""}`}
                >
                  <NativeFieldControl
                    def={def}
                    defaultValue={nativeFieldDefaultValue(unit, def)}
                    className={def.type === "select" ? selectCls : editCls}
                  />
                </Field>
              ))}
              {bySection("Acquisition").map((def) => (
                <Field key={def.key} label={def.label}>
                  <NativeFieldControl
                    def={def}
                    defaultValue={nativeFieldDefaultValue(unit, def)}
                    className={def.type === "select" ? selectCls : editCls}
                  />
                </Field>
              ))}
            </div>

            <div className="mt-5">
              <p className="mb-1 text-xs text-muted">Notes</p>
              <textarea
                name="notes"
                rows={3}
                defaultValue={values.notes}
                placeholder="Ajouter des notes…"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand-subtle"
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vente</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              <Field label="Mise en vente">
                <input
                  type="date"
                  name="listedAt"
                  defaultValue={values.listedAt}
                  className={editCls}
                />
              </Field>
              <Field label="Date de vente">
                <input
                  type="date"
                  name="soldAt"
                  defaultValue={values.soldAt}
                  className={editCls}
                />
              </Field>
              <Field label="Marketplace">
                <select
                  name="soldOn"
                  defaultValue={values.soldOn}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {marketplaces.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Prix de vente">
                <input
                  type="text"
                  name="salePrice"
                  inputMode="decimal"
                  defaultValue={values.salePrice}
                  placeholder="1 250,00"
                  className={editCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Devise">
                  <input
                    type="text"
                    name="saleCurrency"
                    defaultValue={values.saleCurrency}
                    placeholder="EUR"
                    className={editCls}
                  />
                </Field>
                <Field label="Taux de change">
                  <input
                    type="text"
                    name="saleFxRate"
                    inputMode="decimal"
                    defaultValue={values.saleFxRate}
                    placeholder="1"
                    className={editCls}
                  />
                </Field>
              </div>
              <Field label="Régime de TVA">
                <select
                  name="vatScheme"
                  defaultValue={values.vatScheme}
                  className={selectCls}
                >
                  <option value="">Défaut ({tenantSchemeLabel})</option>
                  {VAT_SCHEME_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </CardBody>
        </Card>
      </div>

      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
          <Button type="submit" disabled={pending}>
            <Check className="h-4 w-4" />
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              formRef.current?.reset();
              setDirty(false);
            }}
          >
            <X className="h-4 w-4" /> Annuler
          </Button>
          {state?.error ? (
            <span className="text-sm text-danger">{state.error}</span>
          ) : (
            <span className="text-sm text-muted">
              Modifications non enregistrées
            </span>
          )}
        </div>
      )}
      {state?.ok && !dirty ? (
        <p className="rounded-lg bg-success-subtle px-3 py-2 text-sm text-success">
          Modifications enregistrées.
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useActionState, useRef, useState } from "react";
import type { Company } from "@prisma/client";
import { Check, X } from "lucide-react";
import { updateCompany, type FormResult } from "@/app/actions/companies";
import { Card, CardBody, CardHeader, CardTitle, Button } from "@/components/ui";
import {
  PRIORITE_OPTIONS,
  POTENTIEL_OPTIONS,
  SPECIALTY_FIELDS,
  CANAL_PREFERE_OPTIONS,
} from "@/lib/constants";
import type { StageDef } from "@/lib/stage-meta";
import { formatDate } from "@/lib/utils";

// Subtle "looks like text until you click it" styling for inline editing.
const editCls =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-foreground transition-colors hover:bg-slate-100 focus:border-brand focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-100";
const selectCls =
  "w-full rounded-md border border-border bg-white px-2 py-1 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-indigo-100";

function dateValue(d?: Date | string | null) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-3" : undefined}>
      <label className="mb-0.5 block text-xs text-muted">{label}</label>
      {children}
    </div>
  );
}

export function CompanyInlineEditor({
  company,
  stages,
}: {
  company: Company;
  stages: StageDef[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(async (prev, fd) => {
    const res = await updateCompany(company.id, prev, fd);
    if (res.ok) setDirty(false);
    return res;
  }, undefined);

  function handleReset() {
    formRef.current?.reset();
    setDirty(false);
  }

  const text = (name: keyof Company, placeholder = "—") => (
    <input
      name={name as string}
      defaultValue={(company[name] as string | null) ?? ""}
      placeholder={placeholder}
      className={editCls}
    />
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
      className="space-y-6"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Informations — editable */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Informations</CardTitle>
            <span className="text-xs text-muted">
              Cliquez sur un champ pour le modifier
            </span>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Field label="Nom société">{text("nomSociete")}</Field>
              <Field label="Enseigne">{text("enseigne")}</Field>
              <Field label="SIREN">{text("siren")}</Field>
              <Field label="SIRET *">
                <input
                  name="siret"
                  required
                  defaultValue={company.siret ?? ""}
                  className={editCls}
                />
              </Field>
              <Field label="Catégorie">{text("categorieEntreprise")}</Field>
              <Field label="Forme juridique">{text("formeJuridique")}</Field>
              <Field label="Date de création">
                <input
                  type="date"
                  name="dateCreation"
                  defaultValue={dateValue(company.dateCreation)}
                  className={editCls}
                />
              </Field>
              <Field label="Code NAF">{text("codeNaf")}</Field>
              <Field label="Libellé NAF">{text("libelleNaf")}</Field>
              <Field label="Tranche effectifs">
                {text("trancheEffectifs")}
              </Field>
              <Field label="Adresse" full>
                {text("adresse")}
              </Field>
              <Field label="Code postal">{text("codePostal")}</Field>
              <Field label="Ville">{text("ville")}</Field>
              <Field label="Chiffre d'affaires (€)">
                <input
                  type="number"
                  name="chiffreAffaires"
                  defaultValue={company.chiffreAffaires ?? ""}
                  placeholder="—"
                  className={editCls}
                />
              </Field>
              <Field label="Site web">{text("siteWeb")}</Field>
              <Field label="Email">{text("emailGenerique")}</Field>
              <Field label="Téléphone">{text("telephoneStandard")}</Field>
              <Field label="Communication préférée">
                <select
                  name="canalPrefere"
                  defaultValue={company.canalPrefere ?? ""}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {CANAL_PREFERE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs text-muted">Spécialités</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SPECIALTY_FIELDS.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name={f.key}
                      defaultChecked={Boolean(
                        company[f.key as keyof Company],
                      )}
                      className="h-4 w-4 accent-[var(--brand)]"
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-1 text-xs text-muted">Notes</p>
              <textarea
                name="notes"
                rows={3}
                defaultValue={company.notes ?? ""}
                placeholder="Ajouter des notes…"
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-indigo-100"
              />
            </div>
          </CardBody>
        </Card>

        {/* Qualification — editable */}
        <Card>
          <CardHeader>
            <CardTitle>Qualification</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              <Field label="Étape pipeline">
                <select
                  name="stage"
                  defaultValue={company.stage}
                  className={selectCls}
                >
                  {stages.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priorité">
                <select
                  name="priorite"
                  defaultValue={company.priorite ?? ""}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {PRIORITE_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Potentiel">
                <select
                  name="potentiel"
                  defaultValue={company.potentiel ?? ""}
                  className={selectCls}
                >
                  <option value="">—</option>
                  {POTENTIEL_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Score ICP">
                <input
                  type="number"
                  name="icpScore"
                  defaultValue={company.icpScore ?? ""}
                  placeholder="—"
                  className={editCls}
                />
              </Field>
              <Field label="Nb collaborateurs estimé">
                <input
                  type="number"
                  name="nbCollaborateursEstime"
                  defaultValue={company.nbCollaborateursEstime ?? ""}
                  placeholder="—"
                  className={editCls}
                />
              </Field>
              <Field label="Niveau digitalisation">
                {text("niveauDigitalisation")}
              </Field>
              <Field label="Canal">{text("canal")}</Field>

              {/* Read-only (driven by activity, not edited here) */}
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-muted">Dernier contact</span>
                <span className="text-sm">
                  {formatDate(company.dernierContact)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Relance prévue</span>
                <span className="text-sm">
                  {formatDate(company.relancePrevue)}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Save bar — appears only when something changed */}
      {dirty && (
        <div className="sticky bottom-4 z-10 flex items-center gap-3 rounded-xl border border-border bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <Button type="submit" disabled={pending}>
            <Check className="h-4 w-4" />
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button type="button" variant="secondary" onClick={handleReset}>
            <X className="h-4 w-4" /> Annuler
          </Button>
          {state?.error ? (
            <span className="text-sm text-rose-700">{state.error}</span>
          ) : (
            <span className="text-sm text-muted">
              Modifications non enregistrées
            </span>
          )}
        </div>
      )}
      {state?.ok && !dirty ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Modifications enregistrées.
        </p>
      ) : null}
    </form>
  );
}

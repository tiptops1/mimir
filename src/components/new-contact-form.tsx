"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createContactWithCompany } from "@/app/actions/contacts";
import type { FormResult } from "@/app/actions/contacts";
import { Button, Input, Label, Select } from "@/components/ui";
import { SPECIALTY_FIELDS } from "@/lib/constants";
import type { FieldDef } from "@/lib/field-config";
import { NativeFieldControl } from "@/components/native-field-control";

export interface CompanyOption {
  id: string;
  name: string;
}

export function NewContactForm({
  companies,
  nativeDefs,
}: {
  companies: CompanyOption[];
  nativeDefs: FieldDef[];
}) {
  const router = useRouter();
  const [companyMode, setCompanyMode] = useState<"existing" | "new">(
    companies.length > 0 ? "existing" : "new",
  );
  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(createContactWithCompany, undefined);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="companyMode" value={companyMode} />

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">Société</h3>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setCompanyMode("existing")}
            disabled={companies.length === 0}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
              companyMode === "existing"
                ? "bg-brand text-white"
                : "border border-border bg-white text-foreground hover:bg-slate-50"
            }`}
          >
            Société existante
          </button>
          <button
            type="button"
            onClick={() => setCompanyMode("new")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              companyMode === "new"
                ? "bg-brand text-white"
                : "border border-border bg-white text-foreground hover:bg-slate-50"
            }`}
          >
            Nouvelle société
          </button>
        </div>

        {companyMode === "existing" ? (
          <div>
            <Label htmlFor="companyId">Choisir une société</Label>
            <Select id="companyId" name="companyId" defaultValue="">
              <option value="" disabled>
                — Sélectionner —
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="nomSociete">Nom de la société *</Label>
                <Input id="nomSociete" name="nomSociete" />
              </div>
              <div>
                <Label htmlFor="siteWeb">Site web</Label>
                <Input id="siteWeb" name="siteWeb" placeholder="exemple.fr" />
              </div>
            </div>
            <div>
              <Label>Spécialités</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SPECIALTY_FIELDS.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name={f.key}
                      className="h-4 w-4 accent-[var(--brand)]"
                    />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">Contact</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {["Identité", "Coordonnées"]
            .flatMap((section) =>
              nativeDefs
                .filter((d) => d.section === section)
                .sort((a, b) => a.order - b.order),
            )
            .map((def) => (
              <div key={def.key} className={def.key === "linkedinUrl" ? "sm:col-span-2" : undefined}>
                <Label htmlFor={def.key}>{def.label}</Label>
                <NativeFieldControl
                  def={def}
                  defaultValue=""
                  className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            ))}
        </div>
        <label className="mt-4 flex w-fit items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isDecisionMaker"
            className="h-4 w-4 accent-[var(--brand)]"
          />
          Décideur
        </label>
      </div>

      {state?.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer le contact"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

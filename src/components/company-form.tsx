"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  createCompany,
  updateCompany,
  type FormResult,
} from "@/app/actions/companies";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import {
  PRIORITE_OPTIONS,
  POTENTIEL_OPTIONS,
  SPECIALTY_FIELDS,
  CANAL_PREFERE_OPTIONS,
} from "@/lib/constants";
import type { StageDef } from "@/lib/stage-meta";
import type { FieldDef } from "@/lib/field-config";
import { NativeFieldControl, nativeFieldDefaultValue } from "@/components/native-field-control";

type CompanyLike = {
  id?: string;
  siret?: string | null;
  siren?: string | null;
  nomSociete?: string | null;
  enseigne?: string | null;
  categorieEntreprise?: string | null;
  formeJuridique?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  siteWeb?: string | null;
  emailGenerique?: string | null;
  telephoneStandard?: string | null;
  chiffreAffaires?: number | null;
  canalPrefere?: string | null;
  codeNaf?: string | null;
  libelleNaf?: string | null;
  trancheEffectifs?: string | null;
  dateCreation?: Date | string | null;
  nbCollaborateursEstime?: number | null;
  niveauDigitalisation?: string | null;
  icpScore?: number | null;
  priorite?: string | null;
  potentiel?: string | null;
  stage?: string | null;
  canal?: string | null;
  notes?: string | null;
} & Partial<Record<(typeof SPECIALTY_FIELDS)[number]["key"], boolean>>;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-4 text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function dateValue(d?: Date | string | null) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function CompanyForm({
  company,
  mode,
  stages,
  nativeDefs,
}: {
  company?: CompanyLike;
  mode: "create" | "edit";
  stages: StageDef[];
  nativeDefs: FieldDef[];
}) {
  const router = useRouter();
  const action =
    mode === "edit" && company?.id
      ? updateCompany.bind(null, company.id)
      : createCompany;
  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(action, undefined);

  const record = (company ?? {}) as Record<string, unknown>;
  const bySection = (name: string) =>
    nativeDefs.filter((d) => d.section === name).sort((a, b) => a.order - b.order);

  return (
    <form action={formAction} className="space-y-5">
      <Section title="Identité">
        {bySection("Identité").map((def) => (
          <div key={def.key}>
            <Label htmlFor={def.key}>{def.label}{def.required ? " *" : ""}</Label>
            <NativeFieldControl
              def={def}
              defaultValue={nativeFieldDefaultValue(record, def)}
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        ))}
      </Section>

      <Section title="Coordonnées">
        <div className="sm:col-span-2">
          <Label htmlFor="adresse">Adresse</Label>
          <Input
            id="adresse"
            name="adresse"
            defaultValue={company?.adresse ?? ""}
          />
        </div>
        {bySection("Coordonnées").map((def) => (
          <div key={def.key}>
            <Label htmlFor={def.key}>{def.label}</Label>
            <NativeFieldControl
              def={def}
              defaultValue={nativeFieldDefaultValue(record, def)}
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        ))}
        <div>
          <Label htmlFor="canalPrefere">Communication préférée</Label>
          <Select
            id="canalPrefere"
            name="canalPrefere"
            defaultValue={company?.canalPrefere ?? ""}
          >
            <option value="">—</option>
            {CANAL_PREFERE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </Section>

      <Section title="Qualification">
        <div>
          <Label htmlFor="stage">Étape pipeline</Label>
          <Select
            id="stage"
            name="stage"
            defaultValue={company?.stage ?? stages[0]?.value}
          >
            {stages.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="priorite">Priorité</Label>
          <Select
            id="priorite"
            name="priorite"
            defaultValue={company?.priorite ?? ""}
          >
            <option value="">—</option>
            {PRIORITE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="potentiel">Potentiel</Label>
          <Select
            id="potentiel"
            name="potentiel"
            defaultValue={company?.potentiel ?? ""}
          >
            <option value="">—</option>
            {POTENTIEL_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        {bySection("Qualification").map((def) => (
          <div key={def.key}>
            <Label htmlFor={def.key}>{def.label}</Label>
            <NativeFieldControl
              def={def}
              defaultValue={nativeFieldDefaultValue(record, def)}
              className="flex h-10 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        ))}
      </Section>

      <Section title="Spécialités">
        <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-4">
          {SPECIALTY_FIELDS.map((f) => (
            <label
              key={f.key}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                name={f.key}
                defaultChecked={Boolean(company?.[f.key])}
                className="h-4 w-4 accent-[var(--brand)]"
              />
              {f.label}
            </label>
          ))}
        </div>
      </Section>

      <div className="rounded-xl border border-border bg-card p-5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={company?.notes ?? ""}
        />
      </div>

      {state?.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Enregistré avec succès.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
        >
          Annuler
        </Button>
      </div>
    </form>
  );
}

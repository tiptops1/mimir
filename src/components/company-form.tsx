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
}: {
  company?: CompanyLike;
  mode: "create" | "edit";
  stages: StageDef[];
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

  return (
    <form action={formAction} className="space-y-5">
      <Section title="Identité">
        <div>
          <Label htmlFor="siret">SIRET *</Label>
          <Input
            id="siret"
            name="siret"
            required
            defaultValue={company?.siret ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="siren">SIREN</Label>
          <Input id="siren" name="siren" defaultValue={company?.siren ?? ""} />
        </div>
        <div>
          <Label htmlFor="nomSociete">Nom société</Label>
          <Input
            id="nomSociete"
            name="nomSociete"
            defaultValue={company?.nomSociete ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="enseigne">Enseigne</Label>
          <Input
            id="enseigne"
            name="enseigne"
            defaultValue={company?.enseigne ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="categorieEntreprise">Catégorie</Label>
          <Input
            id="categorieEntreprise"
            name="categorieEntreprise"
            defaultValue={company?.categorieEntreprise ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="formeJuridique">Forme juridique</Label>
          <Input
            id="formeJuridique"
            name="formeJuridique"
            defaultValue={company?.formeJuridique ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="dateCreation">Date de création</Label>
          <Input
            id="dateCreation"
            name="dateCreation"
            type="date"
            defaultValue={dateValue(company?.dateCreation)}
          />
        </div>
        <div>
          <Label htmlFor="trancheEffectifs">Tranche d&apos;effectifs</Label>
          <Input
            id="trancheEffectifs"
            name="trancheEffectifs"
            defaultValue={company?.trancheEffectifs ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="codeNaf">Code NAF</Label>
          <Input
            id="codeNaf"
            name="codeNaf"
            defaultValue={company?.codeNaf ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="libelleNaf">Libellé NAF</Label>
          <Input
            id="libelleNaf"
            name="libelleNaf"
            defaultValue={company?.libelleNaf ?? ""}
          />
        </div>
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
        <div>
          <Label htmlFor="codePostal">Code postal</Label>
          <Input
            id="codePostal"
            name="codePostal"
            defaultValue={company?.codePostal ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="ville">Ville</Label>
          <Input id="ville" name="ville" defaultValue={company?.ville ?? ""} />
        </div>
        <div>
          <Label htmlFor="siteWeb">Site web</Label>
          <Input
            id="siteWeb"
            name="siteWeb"
            defaultValue={company?.siteWeb ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="emailGenerique">Email générique</Label>
          <Input
            id="emailGenerique"
            name="emailGenerique"
            defaultValue={company?.emailGenerique ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="telephoneStandard">Téléphone standard</Label>
          <Input
            id="telephoneStandard"
            name="telephoneStandard"
            defaultValue={company?.telephoneStandard ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="chiffreAffaires">Chiffre d&apos;affaires (€)</Label>
          <Input
            id="chiffreAffaires"
            name="chiffreAffaires"
            type="number"
            defaultValue={company?.chiffreAffaires ?? ""}
          />
        </div>
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
          <Label htmlFor="canal">Canal</Label>
          <Input id="canal" name="canal" defaultValue={company?.canal ?? ""} />
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
        <div>
          <Label htmlFor="icpScore">Score ICP</Label>
          <Input
            id="icpScore"
            name="icpScore"
            type="number"
            defaultValue={company?.icpScore ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="nbCollaborateursEstime">Nb collaborateurs estimé</Label>
          <Input
            id="nbCollaborateursEstime"
            name="nbCollaborateursEstime"
            type="number"
            defaultValue={company?.nbCollaborateursEstime ?? ""}
          />
        </div>
        <div>
          <Label htmlFor="niveauDigitalisation">Niveau digitalisation</Label>
          <Input
            id="niveauDigitalisation"
            name="niveauDigitalisation"
            defaultValue={company?.niveauDigitalisation ?? ""}
          />
        </div>
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

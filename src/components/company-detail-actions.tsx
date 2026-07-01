"use client";

import { useActionState, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Star } from "lucide-react";
import { addActivity, deleteCompany } from "@/app/actions/companies";
import {
  createContact,
  deleteContact,
  toggleDecisionMaker,
} from "@/app/actions/contacts";
import type { FormResult } from "@/app/actions/companies";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ACTIVITY_TYPES } from "@/lib/constants";
import type { FieldDef } from "@/lib/field-config";
import { NativeFieldControl } from "@/components/native-field-control";

export function DeleteCompanyButton({ id }: { id: string }) {
  const action = deleteCompany.bind(null, id);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Supprimer définitivement cette société ?")) {
          e.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="danger">
        <Trash2 className="h-4 w-4" /> Supprimer
      </Button>
    </form>
  );
}

export function AddActivityForm({ companyId }: { companyId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(async (prev, fd) => {
    const res = await addActivity(prev, fd);
    if (res.ok) formRef.current?.reset();
    return res;
  }, undefined);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="flex gap-2">
        <Select name="type" className="w-44" defaultValue="NOTE">
          {ACTIVITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>
      <Textarea
        name="note"
        rows={2}
        placeholder="Ajouter une note ou un compte-rendu…"
      />
      {state?.error ? (
        <p className="text-sm text-rose-700">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Ajout…" : "Ajouter l'activité"}
      </Button>
    </form>
  );
}

export function AddContactForm({
  companyId,
  nativeDefs,
}: {
  companyId: string;
  nativeDefs: FieldDef[];
}) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(async (prev, fd) => {
    const res = await createContact(prev, fd);
    if (res.ok) {
      formRef.current?.reset();
      setOpen(false);
    }
    return res;
  }, undefined);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        + Ajouter un contact
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="space-y-3 rounded-lg border border-border p-4"
    >
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid grid-cols-2 gap-3">
        {["Identité", "Coordonnées"]
          .flatMap((section) =>
            nativeDefs.filter((d) => d.section === section).sort((a, b) => a.order - b.order),
          )
          .map((def) => (
          <div key={def.key}>
            <Label htmlFor={def.key}>{def.label}</Label>
            <NativeFieldControl
              def={def}
              defaultValue=""
              className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand-subtle disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        ))}
      </div>
      {state?.error ? (
        <p className="text-sm text-rose-700">{state.error}</p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Ajout…" : "Enregistrer"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function DecisionMakerToggle({
  id,
  companyId,
  active,
}: {
  id: string;
  companyId: string;
  active: boolean;
}) {
  const action = toggleDecisionMaker.bind(null, id, companyId, !active);
  return (
    <form action={action}>
      <button
        type="submit"
        title={active ? "Décideur — cliquer pour retirer" : "Marquer comme décideur"}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
          active
            ? "bg-amber-100 text-amber-700"
            : "text-faint hover:bg-surface-2 hover:text-foreground"
        }`}
      >
        <Star
          className="h-3.5 w-3.5"
          fill={active ? "currentColor" : "none"}
        />
        Décideur
      </button>
    </form>
  );
}

export function ContactDeleteButton({
  id,
  companyId,
}: {
  id: string;
  companyId: string;
}) {
  const action = deleteContact.bind(null, id, companyId);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Supprimer ce contact ?")) e.preventDefault();
      }}
    >
      <button
        type="submit"
        className="text-faint transition-colors hover:text-rose-600"
        aria-label="Supprimer le contact"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </form>
  );
}

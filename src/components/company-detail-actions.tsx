"use client";

import { useActionState, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { addActivity, deleteCompany } from "@/app/actions/companies";
import { createContact, deleteContact } from "@/app/actions/contacts";
import type { FormResult } from "@/app/actions/companies";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { ACTIVITY_TYPES } from "@/lib/constants";

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

export function AddContactForm({ companyId }: { companyId: string }) {
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
        <div>
          <Label htmlFor="prenom">Prénom</Label>
          <Input id="prenom" name="prenom" />
        </div>
        <div>
          <Label htmlFor="nom">Nom</Label>
          <Input id="nom" name="nom" />
        </div>
        <div>
          <Label htmlFor="fonction">Fonction</Label>
          <Input id="fonction" name="fonction" />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" />
        </div>
        <div>
          <Label htmlFor="telephone">Téléphone</Label>
          <Input id="telephone" name="telephone" />
        </div>
        <div>
          <Label htmlFor="linkedinUrl">LinkedIn</Label>
          <Input id="linkedinUrl" name="linkedinUrl" />
        </div>
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
        className="text-slate-400 transition-colors hover:text-rose-600"
        aria-label="Supprimer le contact"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </form>
  );
}

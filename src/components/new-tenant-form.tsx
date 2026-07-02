"use client";

import { useActionState, useEffect, useState } from "react";
import { createTenant, type PlatformResult } from "@/app/actions/platform";
import { Button, Input, Label } from "@/components/ui";

// Vendor form: provision a new isolated tenant (Phase 4 "Phase 0 on demand").

export function NewTenantForm() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    PlatformResult | undefined,
    FormData
  >(createTenant, undefined);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (state?.ok) setOpen(false); }, [state]);

  if (!open) {
    return (
      <div>
        {state?.ok ? (
          <p className="mb-2 rounded-lg bg-success-subtle px-3 py-2 text-sm text-success">
            Tenant provisionné — CRM vide, entièrement isolé. L&apos;admin peut se
            connecter dès maintenant.
          </p>
        ) : null}
        <Button type="button" onClick={() => setOpen(true)}>
          + Nouveau tenant
        </Button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-border bg-surface-2/60 p-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="slug">Slug (= nom de la base)</Label>
          <Input id="slug" name="slug" placeholder="crm_dupont" required />
        </div>
        <div>
          <Label htmlFor="name">Nom</Label>
          <Input id="name" name="name" placeholder="Cabinet Dupont" required />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="adminEmail">Email admin</Label>
          <Input
            id="adminEmail"
            name="adminEmail"
            type="email"
            placeholder="contact@cabinet-dupont.fr"
            required
          />
        </div>
        <div>
          <Label htmlFor="adminPassword">Mot de passe initial</Label>
          <Input
            id="adminPassword"
            name="adminPassword"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </div>
      </div>

      {state?.error ? (
        <p className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Provisionnement…" : "Provisionner le tenant"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

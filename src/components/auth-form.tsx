"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, register, type AuthState } from "@/app/actions/auth";
import { Button, Input, Label } from "@/components/ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const action = mode === "login" ? login : register;
  const [state, formAction, pending] = useActionState<
    AuthState | undefined,
    FormData
  >(action, undefined);

  return (
    <form action={formAction} className="space-y-4">
      {mode === "register" ? (
        <div>
          <Label htmlFor="name">Nom complet</Label>
          <Input id="name" name="name" placeholder="Jean Dupont" required />
        </div>
      ) : null}

      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="vous@exemple.com"
          autoComplete="email"
          required
        />
      </div>

      <div>
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
        />
      </div>

      {state?.error ? (
        <p className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger ring-1 ring-inset ring-danger/15">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending
          ? "Veuillez patienter…"
          : mode === "login"
            ? "Se connecter"
            : "Créer le compte"}
      </Button>

      <p className="text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            Pas encore de compte ?{" "}
            <Link href="/register" className="font-medium text-brand">
              Inscription
            </Link>
          </>
        ) : (
          <>
            Déjà inscrit ?{" "}
            <Link href="/login" className="font-medium text-brand">
              Connexion
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { controlPrisma } from "@/lib/control-db";
import { createSession, deleteSession } from "@/lib/session";
import { loginSchema } from "@/lib/validations";

export interface AuthState {
  error?: string;
}

export async function login(
  _prev: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Identifiants invalides." };
  }

  const { email, password } = parsed.data;
  // Auth identities live in the control plane; the membership resolves which
  // tenant this user lands in (their DB is selected by the router from tenantId).
  const user = await controlPrisma.user.findUnique({
    where: { email },
    include: { memberships: { include: { tenant: true } } },
  });
  if (!user) {
    return { error: "Email ou mot de passe incorrect." };
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return { error: "Email ou mot de passe incorrect." };
  }

  // Phase 0: a user belongs to exactly one tenant. (Tenant switching for
  // multi-membership users is a later phase.)
  const membership = user.memberships.find((m) => m.tenant.status === "ACTIVE");
  if (!membership) {
    return { error: "Aucun espace actif n'est associé à ce compte." };
  }

  await createSession({
    userId: user.id,
    tenantId: membership.tenantId,
    role: membership.role,
    name: user.name ?? "",
    email: user.email,
  });
  redirect("/dashboard");
}

export async function register(
  _prev: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  // Self-serve signup is Phase 4 (onboarding → provision tenant DB → seed config).
  // Until then, accounts are created by the provisioning scripts.
  void formData;
  return {
    error: "Les inscriptions ne sont pas encore ouvertes.",
  };
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}

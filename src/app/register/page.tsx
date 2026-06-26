import { AuthForm } from "@/components/auth-form";
import { BrandMark } from "@/components/brand";

export default function RegisterPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% -10%, var(--brand-subtle), transparent 60%)",
        }}
      />
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
            Créer un compte
          </h1>
          <p className="mt-1 text-sm text-muted">Rejoignez Vision RM</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-md">
          <AuthForm mode="register" />
        </div>
        <p className="mt-6 text-center text-xs text-faint">
          © {new Date().getFullYear()} Vision RM
        </p>
      </div>
    </main>
  );
}

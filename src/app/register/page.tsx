import { AuthForm } from "@/components/auth-form";
import { BrandMark } from "@/components/brand";

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark />
          <h1 className="mt-4 text-xl font-semibold">Créer un compte</h1>
          <p className="text-sm text-muted">Rejoignez Avelior Analytics</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <AuthForm mode="register" />
        </div>
      </div>
    </main>
  );
}

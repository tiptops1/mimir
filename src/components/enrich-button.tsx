"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export function EnrichButton({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function enrich() {
    setLoading(true);
    setMsg(null);
    setError(false);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (!res.ok || data.found === false) {
        setError(true);
        setMsg(
          data.found === false
            ? "Aucune donnée trouvée pour ce SIREN."
            : data.message || "Échec de l'enrichissement.",
        );
      } else {
        const parts: string[] = [];
        if (data.fieldsUpdated?.length)
          parts.push(`${data.fieldsUpdated.length} champ(s)`);
        if (data.contactsAdded) parts.push(`${data.contactsAdded} contact(s)`);
        setMsg(
          parts.length
            ? `Enrichi : ${parts.join(", ")}.`
            : "Déjà à jour — rien à enrichir.",
        );
        startTransition(() => router.refresh());
      }
    } catch {
      setError(true);
      setMsg("Erreur réseau.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={enrich}
        disabled={loading || pending}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-60"
      >
        <Sparkles className="h-4 w-4 text-brand" />
        {loading || pending ? "Enrichissement…" : "Enrichir"}
      </button>
      {msg ? (
        <span
          className={`text-xs ${error ? "text-rose-600" : "text-emerald-600"}`}
        >
          {msg}
        </span>
      ) : null}
    </div>
  );
}

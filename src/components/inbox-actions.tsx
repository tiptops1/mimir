"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { approvePending, dismissPending } from "@/app/actions/inbox";
import { Button } from "@/components/ui";

export function PendingRow({
  id,
  domain,
  companies,
}: {
  id: string;
  domain: string;
  companies: { id: string; name: string }[];
}) {
  const [companyId, setCompanyId] = useState("__new__");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
        disabled={pending}
        className="max-w-56 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-50"
      >
        <option value="__new__">➕ Nouvelle société « {domain} »</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => approvePending(id, companyId))}
        className="px-2.5 py-1.5 text-xs"
      >
        <Check className="h-3.5 w-3.5" /> Approuver
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={() => startTransition(() => dismissPending(id))}
        className="px-2.5 py-1.5 text-xs"
      >
        <X className="h-3.5 w-3.5" /> Ignorer
      </Button>
    </div>
  );
}

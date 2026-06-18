"use client";

import { useState, useTransition } from "react";
import { setPreferredChannel } from "@/app/actions/companies";
import { CANAL_PREFERE_OPTIONS } from "@/lib/constants";

export function PreferredChannelSelect({
  id,
  value,
  phone,
  email,
  linkedinHref,
  linkedinLabel,
}: {
  id: string;
  value: string | null;
  phone: string | null;
  email: string | null;
  linkedinHref: string | null;
  linkedinLabel: string | null;
}) {
  const [channel, setChannel] = useState(value ?? "");
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    setChannel(next);
    startTransition(() => setPreferredChannel(id, next));
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={channel}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="w-32 rounded-md border border-border bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
      >
        <option value="">—</option>
        {CANAL_PREFERE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {channel === "PHONE" &&
        (phone ? (
          <a
            href={`tel:${phone.replace(/\s/g, "")}`}
            className="text-xs text-brand hover:underline"
          >
            {phone}
          </a>
        ) : (
          <span className="text-xs text-slate-400">Aucun numéro</span>
        ))}

      {channel === "EMAIL" &&
        (email ? (
          <a
            href={`mailto:${email}`}
            className="break-all text-xs text-brand hover:underline"
          >
            {email}
          </a>
        ) : (
          <span className="text-xs text-slate-400">Aucun email</span>
        ))}

      {channel === "LINKEDIN" &&
        (linkedinHref ? (
          <a
            href={linkedinHref}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand hover:underline"
          >
            {linkedinLabel ?? "LinkedIn ↗"}
          </a>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ))}
    </div>
  );
}

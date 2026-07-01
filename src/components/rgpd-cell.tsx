"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Download, Trash2, RefreshCw } from "lucide-react";
import { setContactConsent, eraseContact } from "@/app/actions/rgpd";

// RGPD column on the Contacts table: inline consent select + a small menu with
// export (droit d'accès, JSON) and erase (droit à l'effacement, confirmed).
// Export/erase are ADMIN-only server-side; the menu simply hides them otherwise.

const CONSENT_OPTIONS = [
  { value: "", label: "—" },
  { value: "OPT_IN", label: "Opt-in" },
  { value: "OPT_OUT", label: "Opt-out" },
];

export function RgpdCell({
  contactId,
  consent,
  isAdmin,
}: {
  contactId: string;
  consent: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const onConsent = (value: string) =>
    startTransition(async () => {
      await setContactConsent(contactId, value);
      router.refresh();
    });

  const onErase = () =>
    startTransition(async () => {
      await eraseContact(contactId);
      setOpen(false);
      setConfirming(false);
      router.refresh();
    });

  return (
    <div className="relative flex items-center gap-1.5">
      <select
        value={consent ?? ""}
        disabled={pending}
        onChange={(e) => onConsent(e.target.value)}
        className={`rounded-md border border-border bg-card px-1.5 py-1 text-xs disabled:opacity-50 ${
          consent === "OPT_IN"
            ? "text-success"
            : consent === "OPT_OUT"
              ? "text-danger"
              : "text-muted"
        }`}
        aria-label="Consentement"
      >
        {CONSENT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {isAdmin && (
        <>
          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
              setConfirming(false);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-foreground"
            aria-label="Actions RGPD"
          >
            {pending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoreHorizontal className="h-3.5 w-3.5" />
            )}
          </button>
          {open && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => {
                  setOpen(false);
                  setConfirming(false);
                }}
              />
              <div className="animate-pop absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-border bg-card p-1.5 shadow-lg">
                <a
                  href={`/api/rgpd/export?contactId=${contactId}`}
                  download
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-surface-2"
                >
                  <Download className="h-3.5 w-3.5 text-faint" />
                  Exporter les données (JSON)
                </a>
                {confirming ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={onErase}
                    className="flex w-full items-center gap-2 rounded-md bg-danger-subtle px-2 py-1.5 text-xs font-medium text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Confirmer l&apos;effacement définitif
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-danger hover:bg-danger-subtle"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Effacer (droit à l&apos;oubli)
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

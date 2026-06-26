"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setCompanySpecialties } from "@/app/actions/companies";
import { SPECIALTY_FIELDS } from "@/lib/constants";
import { Badge } from "@/components/ui";

export function SpecialtiesCell({
  id,
  active,
}: {
  id: string;
  // keys of the specialties currently enabled
  active: string[];
}) {
  const [selected, setSelected] = useState<string[]>(active);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function toggle(key: string) {
    const next = selected.includes(key)
      ? selected.filter((k) => k !== key)
      : [...selected, key];
    setSelected(next);
    startTransition(() => setCompanySpecialties(id, next));
  }

  const activeFields = SPECIALTY_FIELDS.filter((f) => selected.includes(f.key));
  // Show at most 4 badges per line so the cell stays compact.
  const rows: (typeof activeFields)[] = [];
  for (let i = 0; i < activeFields.length; i += 4)
    rows.push(activeFields.slice(i, i + 4));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex flex-col items-start gap-1 rounded-md px-1 py-0.5 text-left hover:bg-surface-2 disabled:opacity-50"
        disabled={pending}
      >
        {activeFields.length > 0 ? (
          rows.map((row, ri) => (
            <span key={ri} className="flex items-center gap-1">
              {row.map((f) => (
                <Badge key={f.key} className={f.badge}>
                  {f.label}
                </Badge>
              ))}
            </span>
          ))
        ) : (
          <span className="text-xs text-faint">+ Spécialités</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-border bg-white p-1.5 shadow-lg">
          {SPECIALTY_FIELDS.map((f) => {
            const on = selected.includes(f.key);
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => toggle(f.key)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2"
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    on ? "border-brand bg-brand text-white" : "border-border-strong"
                  }`}
                >
                  {on && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                      <path
                        d="M2.5 6.5L5 9l4.5-5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span
                  className={`inline-flex rounded-full px-1.5 py-0.5 font-medium ${f.badge}`}
                >
                  {f.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

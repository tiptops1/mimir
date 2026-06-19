"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setCompanyEnum, type EnumField } from "@/app/actions/companies";
import { Badge } from "@/components/ui";

export interface EnumOption {
  value: string;
  label: string;
  // Compact label shown in the table badge (falls back to `label`).
  short?: string;
  badge?: string;
  dot?: string;
}

/**
 * Inline dropdown-badge editor for a single enum column (étape, priorité,
 * potentiel). Click the badge → pick a value → saved immediately.
 */
export function EnumCell({
  id,
  field,
  value,
  options,
  nullable = false,
  placeholder = "—",
}: {
  id: string;
  field: EnumField;
  value: string | null;
  options: EnumOption[];
  nullable?: boolean;
  placeholder?: string;
}) {
  const [current, setCurrent] = useState<string | null>(value);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Keep in sync if the server sends a fresh value after revalidation.
  useEffect(() => setCurrent(value), [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function choose(next: string) {
    setCurrent(next === "" ? null : next);
    setOpen(false);
    startTransition(() => setCompanyEnum(id, field, next));
  }

  const selected = options.find((o) => o.value === current);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-slate-100 disabled:opacity-50"
      >
        {selected ? (
          <Badge className={selected.badge ?? "bg-slate-100 text-slate-600"}>
            {selected.dot && (
              <span className={`h-1.5 w-1.5 rounded-full ${selected.dot}`} />
            )}
            {selected.short ?? selected.label}
          </Badge>
        ) : (
          <span className="text-xs text-slate-400">{placeholder} ✎</span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-lg border border-border bg-white p-1.5 shadow-lg">
          {nullable && (
            <button
              type="button"
              onClick={() => choose("")}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
            >
              {placeholder} <span className="text-[10px]">(effacer)</span>
            </button>
          )}
          {options.map((o) => {
            const on = o.value === current;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => choose(o.value)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50 ${
                  on ? "bg-slate-50" : ""
                }`}
              >
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium ${
                    o.badge ?? "bg-slate-100 text-slate-600"
                  }`}
                >
                  {o.dot && (
                    <span className={`h-1.5 w-1.5 rounded-full ${o.dot}`} />
                  )}
                  {o.label}
                </span>
                {on && <span className="ml-auto text-brand">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

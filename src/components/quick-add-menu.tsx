"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, CheckSquare, UserPlus, Building2 } from "lucide-react";

const ITEMS = [
  { href: "/todo", label: "Nouvelle tâche", icon: CheckSquare },
  { href: "/contacts/new", label: "Nouveau contact", icon: UserPlus },
  { href: "/companies/new", label: "Nouvelle société", icon: Building2 },
];

/** Global "+ Nouveau" dropdown in the top bar — fast access to create flows. */
export function QuickAddMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative ml-auto shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Nouveau</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-white p-1.5 shadow-lg">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Icon className="h-4 w-4 text-slate-400" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

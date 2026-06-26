"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, User } from "lucide-react";
import type { SearchHit } from "@/lib/search";

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K focuses the search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Debounced fetch as the user types.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { results?: SearchHit[] };
        setResults(data.results ?? []);
        setActive(0);
        setOpen(true);
      } catch {
        /* aborted or failed — leave prior results */
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    setResults([]);
    router.push(`/companies/${hit.companyId}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active];
      if (hit) go(hit);
    }
  }

  const showDropdown = open && q.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Rechercher société ou contact…"
        className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-12 text-sm outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-indigo-100"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint sm:block">
        ⌘K
      </kbd>

      {showDropdown && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-white shadow-lg">
          {loading && results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Recherche…</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Aucun résultat</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((hit, i) => {
                const Icon = hit.type === "company" ? Building2 : User;
                return (
                  <li key={`${hit.type}-${hit.companyId}-${i}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(hit)}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                        i === active ? "bg-indigo-50" : "hover:bg-surface-2"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-faint" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {hit.title}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {hit.subtitle}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                        {hit.type === "company" ? "Société" : "Contact"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

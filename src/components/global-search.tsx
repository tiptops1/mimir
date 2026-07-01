"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Building2,
  User,
  LayoutDashboard,
  CheckSquare,
  ClipboardList,
  Users,
  KanbanSquare,
  Inbox,
  Wallet,
  BarChart3,
  Settings,
  UserPlus,
  Plus,
  CornerDownLeft,
} from "lucide-react";
import type { SearchHit } from "@/lib/search";

type LucideIcon = typeof Search;

type Command = {
  kind: "nav" | "action";
  href: string;
  label: string;
  keywords: string;
  icon: LucideIcon;
};

type Item =
  | { kind: "command"; command: Command }
  | { kind: "hit"; hit: SearchHit };

const NAV_COMMANDS: Command[] = [
  { kind: "nav", href: "/dashboard", label: "Tableau de bord", keywords: "dashboard accueil home", icon: LayoutDashboard },
  { kind: "nav", href: "/todo", label: "À faire", keywords: "taches tasks todo", icon: CheckSquare },
  { kind: "nav", href: "/companies", label: "Suivi", keywords: "societes companies prospects", icon: ClipboardList },
  { kind: "nav", href: "/contacts", label: "Contacts", keywords: "personnes people", icon: Users },
  { kind: "nav", href: "/pipeline", label: "Pipeline", keywords: "kanban etapes deals affaires", icon: KanbanSquare },
  { kind: "nav", href: "/inbox", label: "Boîte de réception", keywords: "inbox emails courriel", icon: Inbox },
  { kind: "nav", href: "/finances", label: "Finances", keywords: "couts factures abonnements tresorerie", icon: Wallet },
  { kind: "nav", href: "/analytics", label: "Analytique", keywords: "analytics rapports stats", icon: BarChart3 },
];

const ADMIN_COMMANDS: Command[] = [
  { kind: "nav", href: "/settings", label: "Paramètres", keywords: "settings champs etapes config", icon: Settings },
];

const ACTION_COMMANDS: Command[] = [
  { kind: "action", href: "/todo", label: "Nouvelle tâche", keywords: "creer ajouter task", icon: Plus },
  { kind: "action", href: "/contacts/new", label: "Nouveau contact", keywords: "creer ajouter personne", icon: UserPlus },
  { kind: "action", href: "/companies/new", label: "Nouvelle société", keywords: "creer ajouter entreprise company", icon: Building2 },
];

/** Accent-insensitive, case-insensitive match for FR labels. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Command palette in the top bar: ⌘K opens it; empty query lists pages +
 * quick actions; typing filters commands and searches records (Atlas).
 */
export function GlobalSearch({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K opens the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Below the search threshold there are no record hits — reset stale ones
  // during render (https://react.dev/learn/you-might-not-need-an-effect).
  if (q.trim().length < 2 && (results.length > 0 || loading)) {
    setResults([]);
    setLoading(false);
  }

  // Debounced record search as the user types.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { results?: SearchHit[] };
        setResults(data.results ?? []);
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

  const commands = useMemo(() => {
    const all = [
      ...NAV_COMMANDS,
      ...(isAdmin ? ADMIN_COMMANDS : []),
      ...ACTION_COMMANDS,
    ];
    const term = norm(q.trim());
    if (!term) return all;
    return all.filter((c) =>
      `${norm(c.label)} ${c.keywords}`.includes(term),
    );
  }, [q, isAdmin]);

  // Flattened, keyboard-navigable list: commands first, then record hits.
  const items = useMemo<Item[]>(
    () => [
      ...commands.map((command) => ({ kind: "command" as const, command })),
      ...results.map((hit) => ({ kind: "hit" as const, hit })),
    ],
    [commands, results],
  );

  // Clamp the active row when the list shrinks under it.
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));

  function close() {
    setOpen(false);
    setQ("");
    setResults([]);
    setActive(0);
  }

  function run(item: Item) {
    close();
    inputRef.current?.blur();
    router.push(
      item.kind === "command"
        ? item.command.href
        : `/companies/${item.hit.companyId}`,
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      close();
      inputRef.current?.blur();
      return;
    }
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((activeIndex - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) run(item);
    }
  }

  const searching = q.trim().length >= 2;
  const commandCount = commands.length;

  function Row({ item, index }: { item: Item; index: number }) {
    const isActive = index === activeIndex;
    const rowClass = `flex w-full items-center gap-3 px-3 py-2 text-left ${
      isActive ? "bg-brand-subtle" : "hover:bg-surface-2"
    }`;
    if (item.kind === "command") {
      const Icon = item.command.icon;
      return (
        <button
          type="button"
          onMouseEnter={() => setActive(index)}
          onClick={() => run(item)}
          className={rowClass}
        >
          <Icon className="h-4 w-4 shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {item.command.label}
          </span>
          {isActive && (
            <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-faint" />
          )}
        </button>
      );
    }
    const Icon = item.hit.type === "company" ? Building2 : User;
    return (
      <button
        type="button"
        onMouseEnter={() => setActive(index)}
        onClick={() => run(item)}
        className={rowClass}
      >
        <Icon className="h-4 w-4 shrink-0 text-faint" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {item.hit.title}
          </span>
          <span className="block truncate text-xs text-muted">
            {item.hit.subtitle}
          </span>
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
          {item.hit.type === "company" ? "Société" : "Contact"}
        </span>
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Rechercher ou naviguer…"
        className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-12 text-sm outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-[var(--ring)]"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint sm:block">
        ⌘K
      </kbd>

      {open && (
        <div className="animate-pop absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          <div className="max-h-96 overflow-y-auto py-1">
            {commandCount > 0 && (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  {searching ? "Pages & actions" : "Navigation"}
                </p>
                <ul>
                  {items.slice(0, commandCount).map((item, i) => (
                    <li key={`c-${i}`}>
                      <Row item={item} index={i} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {searching && (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-faint">
                  Résultats
                </p>
                {loading && results.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted">Recherche…</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted">
                    Aucun résultat
                  </p>
                ) : (
                  <ul>
                    {items.slice(commandCount).map((item, i) => (
                      <li key={`h-${i}`}>
                        <Row item={item} index={commandCount + i} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

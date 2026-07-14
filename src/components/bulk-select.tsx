"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { bulkSetCompanyEnum, type EnumField } from "@/app/actions/companies";
import { bulkEnrollCompanies } from "@/app/actions/sequences";
import { PRIORITE_OPTIONS, POTENTIEL_OPTIONS } from "@/lib/constants";

// Bulk actions on the Suivi table (P2.2). The server component wraps the table
// in <BulkProvider pageIds=…>; each row renders a <BulkRowCheckbox>, the header
// a <BulkHeaderCheckbox>, and a floating bar appears once something is selected.
// Selection is page-local by design (it resets on pagination/filter changes).

interface BulkContextValue {
  selected: Set<string>;
  pageIds: string[];
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
}

const BulkContext = createContext<BulkContextValue | null>(null);

function useBulk(): BulkContextValue {
  const ctx = useContext(BulkContext);
  if (!ctx) throw new Error("Bulk components must live under <BulkProvider>");
  return ctx;
}

export interface BulkSequenceOption {
  id: string;
  label: string;
}

export function BulkProvider({
  pageIds,
  stages,
  sequences = [],
  children,
}: {
  pageIds: string[];
  stages: Array<{ value: string; label: string }>;
  sequences?: BulkSequenceOption[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const value = useMemo<BulkContextValue>(
    () => ({
      selected,
      pageIds,
      toggle: (id) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      toggleAll: () =>
        setSelected((prev) =>
          pageIds.every((id) => prev.has(id))
            ? new Set()
            : new Set(pageIds),
        ),
      clear: () => setSelected(new Set()),
    }),
    [selected, pageIds],
  );

  return (
    <BulkContext.Provider value={value}>
      {children}
      <BulkBar stages={stages} sequences={sequences} />
    </BulkContext.Provider>
  );
}

const CHECKBOX_CLS = "h-4 w-4 cursor-pointer accent-[var(--brand)]";

export function BulkHeaderCheckbox() {
  const { selected, pageIds, toggleAll } = useBulk();
  const allChecked = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      aria-label="Tout sélectionner"
      className={CHECKBOX_CLS}
      checked={allChecked}
      onChange={toggleAll}
    />
  );
}

export function BulkRowCheckbox({ id }: { id: string }) {
  const { selected, toggle } = useBulk();
  return (
    <input
      type="checkbox"
      aria-label="Sélectionner la ligne"
      className={CHECKBOX_CLS}
      checked={selected.has(id)}
      onChange={() => toggle(id)}
    />
  );
}

const SELECT_CLS =
  "rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand disabled:opacity-50";

function BulkBar({
  stages,
  sequences,
}: {
  stages: Array<{ value: string; label: string }>;
  sequences: BulkSequenceOption[];
}) {
  const { selected, clear } = useBulk();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enrollResult, setEnrollResult] = useState<{
    enrolled: number;
    skipped: number;
  } | null>(null);

  if (selected.size === 0) return null;

  const apply = (field: EnumField, value: string) => {
    if (!value) return;
    startTransition(async () => {
      await bulkSetCompanyEnum([...selected], field, value);
      router.refresh();
    });
  };

  const enroll = (sequenceId: string) => {
    if (!sequenceId) return;
    startTransition(async () => {
      const res = await bulkEnrollCompanies([...selected], sequenceId);
      setEnrollResult({ enrolled: res.enrolled, skipped: res.skipped.length });
      router.refresh();
    });
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="animate-pop flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur">
        <span className="text-sm font-medium text-foreground tnum">
          {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}
        </span>
        {pending ? (
          <RefreshCw className="h-4 w-4 animate-spin text-muted" />
        ) : null}
        <select
          className={SELECT_CLS}
          disabled={pending}
          value=""
          onChange={(e) => apply("stage", e.target.value)}
        >
          <option value="">Étape…</option>
          {stages.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLS}
          disabled={pending}
          value=""
          onChange={(e) => apply("priorite", e.target.value)}
        >
          <option value="">Priorité…</option>
          {PRIORITE_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLS}
          disabled={pending}
          value=""
          onChange={(e) => apply("potentiel", e.target.value)}
        >
          <option value="">Potentiel…</option>
          {POTENTIEL_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        {sequences.length > 0 && (
          <select
            className={SELECT_CLS}
            disabled={pending}
            value=""
            onChange={(e) => enroll(e.target.value)}
          >
            <option value="">Enrôler dans une séquence…</option>
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {enrollResult && (
          <span className="text-xs text-muted">
            {enrollResult.enrolled} inscrite
            {enrollResult.enrolled > 1 ? "s" : ""}
            {enrollResult.skipped > 0
              ? `, ${enrollResult.skipped} ignorée${enrollResult.skipped > 1 ? "s" : ""}`
              : ""}
          </span>
        )}
        <button
          type="button"
          onClick={clear}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground"
          aria-label="Annuler la sélection"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

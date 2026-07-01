"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  setFinanceStatus,
  setFinanceField,
  deleteFinanceEntry,
} from "@/app/actions/finances";
import {
  KIND_META,
  STATUS_META,
  statusOptionsFor,
  RECURRENCE_LABELS,
  FINANCE_KINDS,
  type FinanceRow,
  type FinanceKind,
} from "@/lib/finance";
import { formatCurrency } from "@/lib/display";
import { Badge, Button, Input } from "@/components/ui";
import { FinanceEntryForm } from "@/components/finance-entry-form";

/** Inline status badge → dropdown (kind-validated), mirrors EnumCell. */
function StatusCell({ row }: { row: FinanceRow }) {
  const [current, setCurrent] = useState(row.status);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  // Re-sync local state when the server sends a fresh value after revalidation
  // (render-time adjustment — the React-recommended alternative to an effect).
  const [seen, setSeen] = useState(row.status);
  if (row.status !== seen) {
    setSeen(row.status);
    setCurrent(row.status);
  }

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const meta = STATUS_META[current];
  const options = statusOptionsFor(row.kind);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="inline-flex items-center rounded-md px-1 py-0.5 hover:bg-surface-2 disabled:opacity-50"
      >
        <Badge className={meta?.badge ?? "bg-surface-2 text-muted"}>
          {meta?.label ?? current}
        </Badge>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-card p-1.5 shadow-lg">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                setCurrent(o.value);
                setOpen(false);
                startTransition(() => setFinanceStatus(row.id, o.value));
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-surface-2 ${
                o.value === current ? "bg-surface-2" : ""
              }`}
            >
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${o.badge}`}
              >
                {o.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inline amount editor — click the figure to edit, save on blur/Enter. */
function AmountCell({ row }: { row: FinanceRow }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.amount));
  const [pending, startTransition] = useTransition();

  // Re-sync to a server-fresh amount after revalidation, unless mid-edit.
  const [seenAmount, setSeenAmount] = useState(row.amount);
  if (!editing && row.amount !== seenAmount) {
    setSeenAmount(row.amount);
    setValue(String(row.amount));
  }

  const suffix =
    row.recurrence !== "NONE"
      ? ` / ${RECURRENCE_LABELS[row.recurrence]?.toLowerCase() ?? ""}`
      : "";

  function save() {
    setEditing(false);
    if (value !== String(row.amount)) {
      startTransition(() => setFinanceField(row.id, "amount", value));
    }
  }

  if (editing) {
    return (
      <Input
        autoFocus
        type="number"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setValue(String(row.amount));
            setEditing(false);
          }
        }}
        className="h-8 w-28 text-right"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={pending}
      className={`rounded-md px-1 py-0.5 tabular-nums hover:bg-surface-2 disabled:opacity-50 ${
        row.direction === "IN" ? "text-emerald-700" : "text-foreground"
      }`}
    >
      {row.direction === "IN" ? "+" : ""}
      {formatCurrency(row.amount, row.currency)}
      <span className="text-xs text-muted">{suffix}</span>
    </button>
  );
}

function Row({ row }: { row: FinanceRow }) {
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState(false);
  if (removed) return null;

  const kindMeta = KIND_META[row.kind];

  return (
    <tr className="border-t border-border hover:bg-surface-2/60">
      <td className="px-4 py-2.5">
        <Link
          href={`/finances/${row.id}`}
          className="text-sm font-medium hover:underline"
        >
          {row.label}
        </Link>
        <div className="text-xs text-muted">
          <span className={`mr-1 inline-block rounded px-1 ${kindMeta?.badge}`}>
            {kindMeta?.label}
          </span>
          {row.vendor ?? row.company?.name ?? ""}
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm text-muted">{row.category ?? "—"}</td>
      <td className="px-4 py-2.5">
        <StatusCell row={row} />
      </td>
      <td className="px-4 py-2.5 text-right text-sm">
        <AmountCell row={row} />
      </td>
      <td className="px-2 py-2.5 text-right">
        <div className="inline-flex items-center gap-1">
          <Link
            href={`/finances/${row.id}`}
            className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-foreground"
            aria-label="Modifier"
          >
            <Pencil className="h-4 w-4" />
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Supprimer « ${row.label} » ?`)) return;
              setRemoved(true);
              startTransition(() => deleteFinanceEntry(row.id));
            }}
            className="rounded-md p-1 text-faint hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            aria-label="Supprimer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

export function FinanceTable({
  entries,
  categories,
  companies,
}: {
  entries: FinanceRow[];
  categories: string[];
  companies: { id: string; name: string }[];
}) {
  const [segment, setSegment] = useState<"ALL" | FinanceKind>("ALL");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const filtered = entries.filter((e) => {
    if (segment !== "ALL" && e.kind !== segment) return false;
    if (q) {
      const hay = `${e.label} ${e.vendor ?? ""} ${e.category ?? ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const segments: { value: "ALL" | FinanceKind; label: string }[] = [
    { value: "ALL", label: "Tout" },
    ...FINANCE_KINDS.map((k) => ({ value: k.value, label: k.plural })),
  ];

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="flex flex-wrap gap-1">
          {segments.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSegment(s.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                segment === s.value
                  ? "bg-brand-subtle text-brand"
                  : "text-muted hover:bg-surface-2"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher…"
            className="h-9 w-44"
          />
          <Button onClick={() => setAdding((v) => !v)} className="shrink-0">
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
        </div>
      </div>

      {adding && (
        <div className="border-b border-border bg-surface-2/60 p-4">
          <FinanceEntryForm
            mode="create"
            categories={categories}
            companies={companies}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted">
          Aucune entrée. Cliquez sur « Ajouter » pour enregistrer un coût, un
          abonnement ou une facture.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Poste</th>
                <th className="px-4 py-2 font-medium">Catégorie</th>
                <th className="px-4 py-2 font-medium">Statut</th>
                <th className="px-4 py-2 text-right font-medium">Montant</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <Row key={e.id} row={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

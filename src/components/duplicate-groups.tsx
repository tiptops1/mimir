"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { GitMerge, RefreshCw } from "lucide-react";
import { mergeCompanies, mergeContacts } from "@/app/actions/dedupe";
import type { DupCompany, DupContact, DupGroup } from "@/lib/dedupe";

// Review UI for /settings/duplicates: one card per group, pick the row to keep
// (defaults to the most active / oldest), merge the rest into it.

const KIND_LABEL: Record<string, string> = {
  name: "Même nom",
  domain: "Même site web",
  email: "Même email",
};

function GroupCard({
  title,
  kind,
  children,
  onMerge,
  pending,
  error,
}: {
  title: string;
  kind: string;
  children: React.ReactNode;
  onMerge: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <span className="mr-2 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
            {KIND_LABEL[kind] ?? kind}
          </span>
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        <button
          type="button"
          onClick={onMerge}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {pending ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <GitMerge className="h-4 w-4" />
          )}
          Fusionner
        </button>
      </div>
      <div className="space-y-1.5">{children}</div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </div>
  );
}

function RowShell({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
        checked
          ? "border-brand bg-brand-subtle/50"
          : "border-border hover:bg-surface-2"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="h-4 w-4 accent-[var(--brand)]"
        aria-label="Conserver cette fiche"
      />
      {children}
      {checked ? (
        <span className="ml-auto shrink-0 text-xs font-medium text-brand">
          Conservée
        </span>
      ) : null}
    </label>
  );
}

/** Default keeper = most activities, then most contacts, then oldest row. */
function defaultCompanyKeeper(rows: DupCompany[]): string {
  return [...rows].sort(
    (a, b) =>
      b.activities - a.activities ||
      b.contacts - a.contacts ||
      +new Date(a.createdAt) - +new Date(b.createdAt),
  )[0].id;
}

export function CompanyDuplicateGroup({
  group,
}: {
  group: DupGroup<DupCompany>;
}) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(() => defaultCompanyKeeper(group.rows));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const merge = () =>
    startTransition(async () => {
      const res = await mergeCompanies(
        keepId,
        group.rows.map((r) => r.id).filter((id) => id !== keepId),
      );
      if (res.error) setError(res.error);
      else router.refresh();
    });

  return (
    <GroupCard
      title={group.key}
      kind={group.kind}
      onMerge={merge}
      pending={pending}
      error={error}
    >
      {group.rows.map((r) => (
        <RowShell
          key={r.id}
          checked={keepId === r.id}
          onSelect={() => setKeepId(r.id)}
        >
          <span className="min-w-0">
            <Link
              href={`/companies/${r.id}`}
              className="font-medium text-foreground hover:text-brand"
              target="_blank"
            >
              {r.label}
            </Link>
            <span className="ml-2 text-xs text-muted">
              {r.ville ?? "—"} · {r.contacts} contact{r.contacts > 1 ? "s" : ""} ·{" "}
              {r.activities} activité{r.activities > 1 ? "s" : ""}
            </span>
            <span className="ml-2 text-xs text-faint tnum">{r.siret}</span>
          </span>
        </RowShell>
      ))}
    </GroupCard>
  );
}

function defaultContactKeeper(rows: DupContact[]): string {
  return [...rows].sort(
    (a, b) =>
      b.activities - a.activities ||
      +new Date(a.createdAt) - +new Date(b.createdAt),
  )[0].id;
}

export function ContactDuplicateGroup({
  group,
}: {
  group: DupGroup<DupContact>;
}) {
  const router = useRouter();
  const [keepId, setKeepId] = useState(() => defaultContactKeeper(group.rows));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const merge = () =>
    startTransition(async () => {
      const res = await mergeContacts(
        keepId,
        group.rows.map((r) => r.id).filter((id) => id !== keepId),
      );
      if (res.error) setError(res.error);
      else router.refresh();
    });

  return (
    <GroupCard
      title={group.key}
      kind={group.kind}
      onMerge={merge}
      pending={pending}
      error={error}
    >
      {group.rows.map((r) => (
        <RowShell
          key={r.id}
          checked={keepId === r.id}
          onSelect={() => setKeepId(r.id)}
        >
          <span className="min-w-0">
            <span className="font-medium text-foreground">{r.name}</span>
            <Link
              href={`/companies/${r.companyId}`}
              className="ml-2 text-xs text-muted hover:text-brand"
              target="_blank"
            >
              {r.companyLabel}
            </Link>
            <span className="ml-2 text-xs text-faint">
              {r.activities} activité{r.activities > 1 ? "s" : ""}
            </span>
          </span>
        </RowShell>
      ))}
    </GroupCard>
  );
}

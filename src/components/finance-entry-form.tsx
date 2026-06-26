"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createFinanceEntry,
  updateFinanceEntry,
} from "@/app/actions/finances";
import type { FormResult } from "@/app/actions/companies";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import {
  FINANCE_KINDS,
  RECURRENCE_OPTIONS,
  statusOptionsFor,
  defaultStatusFor,
  type FinanceKind,
  type FinanceRow,
} from "@/lib/finance";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-4 text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function dateValue(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export function FinanceEntryForm({
  entry,
  mode,
  categories,
  companies,
  onDone,
}: {
  entry?: FinanceRow;
  mode: "create" | "edit";
  categories: string[];
  companies: { id: string; name: string }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const action =
    mode === "edit" && entry?.id
      ? updateFinanceEntry.bind(null, entry.id)
      : createFinanceEntry;
  const [state, formAction, pending] = useActionState<
    FormResult | undefined,
    FormData
  >(action, undefined);

  const [kind, setKind] = useState<FinanceKind>(entry?.kind ?? "SUBSCRIPTION");
  const isInvoice = kind === "INVOICE";
  const isSub = kind === "SUBSCRIPTION";
  const isStaff = kind === "STAFF";
  const isExpense = kind === "EXPENSE";

  // Close the quick-add on success; refresh so the revalidated list shows.
  useEffect(() => {
    if (state?.ok && onDone) onDone();
    if (state?.ok && mode === "edit") router.refresh();
  }, [state?.ok, onDone, mode, router]);

  const statusOptions = statusOptionsFor(kind);

  return (
    <form action={formAction} className="space-y-5">
      <Section title="Détails">
        <div>
          <Label htmlFor="kind">Type</Label>
          <Select
            id="kind"
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as FinanceKind)}
          >
            {FINANCE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="label">Intitulé *</Label>
          <Input
            id="label"
            name="label"
            required
            defaultValue={entry?.label ?? ""}
            placeholder={isInvoice ? "Facture 2026-014" : "Notion"}
          />
        </div>
        <div>
          <Label htmlFor="amount">Montant (€)</Label>
          <Input
            id="amount"
            name="amount"
            type="number"
            min="0"
            defaultValue={entry?.amount ? String(entry.amount) : ""}
          />
        </div>
        <div>
          <Label htmlFor="category">Catégorie</Label>
          <Select
            id="category"
            name="category"
            defaultValue={entry?.category ?? ""}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="vendor">{isInvoice ? "Client" : "Fournisseur"}</Label>
          <Input id="vendor" name="vendor" defaultValue={entry?.vendor ?? ""} />
        </div>
        <div>
          <Label htmlFor="status">Statut</Label>
          <Select
            id="status"
            name="status"
            defaultValue={entry?.status ?? defaultStatusFor(kind)}
            key={kind}
          >
            {statusOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        {!isExpense && !isInvoice && (
          <div>
            <Label htmlFor="recurrence">Récurrence</Label>
            <Select
              id="recurrence"
              name="recurrence"
              defaultValue={entry?.recurrence ?? "MONTHLY"}
            >
              {RECURRENCE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {companies.length > 0 && (
          <div>
            <Label htmlFor="companyId">Lié à (CRM)</Label>
            <Select
              id="companyId"
              name="companyId"
              defaultValue={entry?.company?.id ?? ""}
            >
              <option value="">—</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </Section>

      <Section title="Échéances">
        {isExpense && (
          <div>
            <Label htmlFor="date">Date de la dépense</Label>
            <Input
              id="date"
              name="date"
              type="date"
              defaultValue={dateValue(entry?.date)}
            />
          </div>
        )}
        {isInvoice && (
          <>
            <div>
              <Label htmlFor="date">Date d&apos;émission</Label>
              <Input
                id="date"
                name="date"
                type="date"
                defaultValue={dateValue(entry?.date)}
              />
            </div>
            <div>
              <Label htmlFor="dueDate">Échéance</Label>
              <Input
                id="dueDate"
                name="dueDate"
                type="date"
                defaultValue={dateValue(entry?.dueDate)}
              />
            </div>
          </>
        )}
        {(isSub || isStaff) && (
          <div>
            <Label htmlFor="startDate">Début</Label>
            <Input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={dateValue(entry?.startDate)}
            />
          </div>
        )}
        {isStaff && (
          <div>
            <Label htmlFor="endDate">Fin</Label>
            <Input
              id="endDate"
              name="endDate"
              type="date"
              defaultValue={dateValue(entry?.endDate)}
            />
          </div>
        )}
        {isSub && (
          <>
            <div>
              <Label htmlFor="renewsAt">Prochain renouvellement</Label>
              <Input
                id="renewsAt"
                name="renewsAt"
                type="date"
                defaultValue={dateValue(entry?.renewsAt)}
              />
            </div>
            <div>
              <Label htmlFor="trialEndsAt">Fin d&apos;essai gratuit</Label>
              <Input
                id="trialEndsAt"
                name="trialEndsAt"
                type="date"
                defaultValue={dateValue(entry?.trialEndsAt)}
              />
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="autoRenew"
                defaultChecked={entry?.autoRenew ?? true}
                className="h-4 w-4 accent-[var(--brand)]"
              />
              Renouvellement automatique
            </label>
          </>
        )}
      </Section>

      <div className="rounded-xl border border-border bg-card p-5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={3} defaultValue={entry?.notes ?? ""} />
      </div>

      {state?.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {onDone ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            Annuler
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.back()}
          >
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

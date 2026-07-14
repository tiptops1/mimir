"use client";

import { useState, useTransition } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Button, Select } from "@/components/ui";
import {
  enrollCompany,
  setEnrollmentStatus,
  deleteEnrollment,
} from "@/app/actions/sequences";
import { formatDate } from "@/lib/utils";

export interface SequenceOption {
  id: string;
  name: string;
  stepCount: number;
}

export interface EnrollmentRow {
  id: string;
  sequenceName: string;
  status: string;
  nextDueAt: string | null;
  currentStep: number;
  stepCount: number;
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PAUSED: "bg-amber-100 text-amber-700",
  DONE: "bg-surface-2 text-muted",
  REPLIED: "bg-sky-100 text-sky-700",
  BOUNCED: "bg-rose-100 text-rose-700",
  OPTED_OUT: "bg-rose-100 text-rose-700",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "En pause",
  DONE: "Terminée",
  REPLIED: "A répondu",
  BOUNCED: "Email invalide",
  OPTED_OUT: "Désinscrite",
};

function EnrollmentItem({
  enr,
  companyId,
}: {
  enr: EnrollmentRow;
  companyId: string;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{enr.sequenceName}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              STATUS_STYLE[enr.status] ?? "bg-surface-2 text-muted"
            }`}
          >
            {STATUS_LABEL[enr.status] ?? enr.status}
          </span>
        </div>
        <p className="text-xs text-muted">
          Étape {Math.min(enr.currentStep + 1, enr.stepCount)}/{enr.stepCount}
          {enr.status === "ACTIVE" && enr.nextDueAt
            ? ` · prochaine le ${formatDate(enr.nextDueAt)}`
            : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {(enr.status === "ACTIVE" || enr.status === "PAUSED") && (
          <button
            type="button"
            disabled={pending}
            title={enr.status === "ACTIVE" ? "Mettre en pause" : "Reprendre"}
            onClick={() =>
              start(async () => {
                await setEnrollmentStatus(
                  enr.id,
                  companyId,
                  enr.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                );
              })
            }
            className="text-faint hover:text-brand"
          >
            {enr.status === "ACTIVE" ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          title="Retirer"
          onClick={() =>
            start(async () => {
              await deleteEnrollment(enr.id, companyId);
            })
          }
          className="text-faint hover:text-rose-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function SequencesCard({
  companyId,
  sequences,
  enrollments,
}: {
  companyId: string;
  sequences: SequenceOption[];
  enrollments: EnrollmentRow[];
}) {
  const [sel, setSel] = useState(sequences[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      {enrollments.length === 0 ? (
        <p className="text-sm text-muted">Pas encore enrôlée dans une séquence.</p>
      ) : (
        enrollments.map((e) => (
          <EnrollmentItem key={e.id} enr={e} companyId={companyId} />
        ))
      )}

      {sequences.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Select
              value={sel}
              onChange={(e) => setSel(e.target.value)}
              className="h-9 flex-1 py-1.5 text-sm"
            >
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.stepCount} étapes)
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={pending || !sel}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await enrollCompany(companyId, sel);
                  if (res?.error) setError(res.error);
                })
              }
            >
              {pending ? "…" : "Enrôler"}
            </Button>
          </div>
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

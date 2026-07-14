"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import {
  createSequence,
  updateSequence,
  deleteSequence,
  type SequencePayload,
} from "@/app/actions/outreach-sequences";
import type { SequenceMode, SequenceStep } from "@/lib/sequences";
import {
  renderTemplate,
  PREVIEW_VARS,
  TEMPLATE_VAR_DEFS,
} from "@/lib/outreach/template";

// Stateful editor for one outreach sequence (create + edit). Steps live in
// local state and are saved wholesale through the typed server actions. Up/down
// buttons instead of drag-drop: 3-5 steps don't warrant @dnd-kit here.

export interface SequenceEditorInitial {
  id?: string;
  name: string;
  mode: SequenceMode;
  active: boolean;
  steps: SequenceStep[];
}

const EMPTY_STEP: SequenceStep = {
  offsetDays: 0,
  channel: "EMAIL",
  title: "",
  subject: "",
  body: "",
};

export function SequenceEditor({ initial }: { initial: SequenceEditorInitial }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [mode, setMode] = useState<SequenceMode>(initial.mode);
  const [active, setActive] = useState(initial.active);
  const [steps, setSteps] = useState<SequenceStep[]>(
    initial.steps.length > 0 ? initial.steps : [{ ...EMPTY_STEP }],
  );
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  // Only the FIRST email step carries a subject — later ones thread as "Re:".
  const firstEmailIndex = useMemo(
    () => steps.findIndex((s) => s.channel === "EMAIL"),
    [steps],
  );

  const patchStep = (i: number, patch: Partial<SequenceStep>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const removeStep = (i: number) =>
    setSteps((prev) => prev.filter((_, j) => j !== i));

  const addStep = () =>
    setSteps((prev) => [
      ...prev,
      {
        ...EMPTY_STEP,
        offsetDays: (prev[prev.length - 1]?.offsetDays ?? 0) + 3,
      },
    ]);

  const insertVar = (i: number, key: string) =>
    patchStep(i, { body: `${steps[i].body ?? ""}{{${key}}}` });

  const save = () => {
    setError(null);
    const payload: SequencePayload = { name, mode, active, steps };
    startTransition(async () => {
      const res = initial.id
        ? await updateSequence(initial.id, payload)
        : await createSequence(payload);
      if (res.error) setError(res.error);
      else router.push("/outreach/sequences");
    });
  };

  const remove = () => {
    if (!initial.id) return;
    if (!window.confirm("Supprimer cette séquence ?")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSequence(initial.id!);
      if (res.error) setError(res.error);
      else router.push("/outreach/sequences");
    });
  };

  const dayLabel = mode === "AUTO_EMAIL" ? "Jour (J+, jours ouvrés)" : "Jour (J+)";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {initial.id ? "Modifier la séquence" : "Nouvelle séquence"}
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="seq-name">Nom</Label>
              <Input
                id="seq-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. Cold email courtiers santé"
              />
            </div>
            <div>
              <Label htmlFor="seq-mode">Mode</Label>
              <Select
                id="seq-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as SequenceMode)}
              >
                <option value="AUTO_EMAIL">
                  Envoi automatique (cold email)
                </option>
                <option value="TASKS">Tâches manuelles</option>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted">
            {mode === "AUTO_EMAIL"
              ? "Les emails partent automatiquement depuis la boîte d'envoi cold email, en jours ouvrés, dans la limite du plafond quotidien. Une réponse du prospect sort immédiatement la société de la séquence."
              : "Chaque étape crée une tâche dans votre liste « À faire » — rien ne part sans vous."}
          </p>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Séquence active (de nouvelles sociétés peuvent y être inscrites)
          </label>
        </CardBody>
      </Card>

      {steps.map((step, i) => {
        const isEmail = step.channel === "EMAIL";
        const isFirstEmail = i === firstEmailIndex;
        const showTemplates = mode === "AUTO_EMAIL" && isEmail;
        return (
          <Card key={i}>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>
                Étape {i + 1} — J+{step.offsetDays}
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveStep(i, -1)}
                  disabled={i === 0}
                  aria-label="Monter"
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => moveStep(i, 1)}
                  disabled={i === steps.length - 1}
                  aria-label="Descendre"
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeStep(i)}
                  disabled={steps.length === 1}
                  aria-label="Supprimer l'étape"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label>{dayLabel}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={step.offsetDays}
                    onChange={(e) =>
                      patchStep(i, { offsetDays: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Canal</Label>
                  <Select
                    value={step.channel}
                    onChange={(e) =>
                      patchStep(i, {
                        channel: e.target.value as SequenceStep["channel"],
                      })
                    }
                  >
                    <option value="EMAIL">Email</option>
                    <option value="APPEL">Appel</option>
                    <option value="LINKEDIN">LinkedIn</option>
                  </Select>
                </div>
                <div>
                  <Label>Titre</Label>
                  <Input
                    value={step.title}
                    onChange={(e) => patchStep(i, { title: e.target.value })}
                    placeholder="Ex. Accroche, Relance douce…"
                  />
                </div>
              </div>

              {showTemplates && (
                <>
                  {isFirstEmail ? (
                    <div>
                      <Label>Objet</Label>
                      <Input
                        value={step.subject ?? ""}
                        onChange={(e) => patchStep(i, { subject: e.target.value })}
                        placeholder="Ex. Vos comparatifs santé en euros par acte"
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted">
                      Répond dans le même fil (Re&nbsp;: objet du premier email).
                    </p>
                  )}
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <Label className="mb-0">Texte de l&apos;email</Label>
                      <div className="flex flex-wrap gap-1">
                        {TEMPLATE_VAR_DEFS.map((v) => (
                          <button
                            key={v.key}
                            type="button"
                            onClick={() => insertVar(i, v.key)}
                            title={v.label}
                            className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted hover:text-foreground"
                          >
                            {`{{${v.key}}}`}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewIndex(previewIndex === i ? null : i)
                          }
                          className="inline-flex items-center gap-1 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted hover:text-foreground"
                        >
                          {previewIndex === i ? (
                            <EyeOff className="h-3 w-3" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                          Aperçu
                        </button>
                      </div>
                    </div>
                    <Textarea
                      rows={6}
                      value={step.body ?? ""}
                      onChange={(e) => patchStep(i, { body: e.target.value })}
                      placeholder={
                        "Bonjour {{prenom}},\n\nVous comparez des contrats santé pour vos clients ?…"
                      }
                    />
                    {previewIndex === i && (
                      <div className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-sm text-foreground">
                        {renderTemplate(step.body ?? "", PREVIEW_VARS) ||
                          "(vide)"}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        );
      })}

      <Button variant="secondary" onClick={addStep}>
        <Plus className="h-4 w-4" />
        Ajouter une étape
      </Button>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={pending}>
          {pending && <RefreshCw className="h-4 w-4 animate-spin" />}
          Enregistrer
        </Button>
        <Button
          variant="secondary"
          onClick={() => router.push("/outreach/sequences")}
          disabled={pending}
        >
          Annuler
        </Button>
        {initial.id && (
          <Button variant="danger" onClick={remove} disabled={pending}>
            <Trash2 className="h-4 w-4" />
            Supprimer
          </Button>
        )}
      </div>
    </div>
  );
}

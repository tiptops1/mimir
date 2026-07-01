"use client";

import { useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button, Badge } from "@/components/ui";
import { StageDefForm } from "@/components/stage-def-form";
import { deleteStageDef, reorderStageDefs } from "@/app/actions/stage-config";
import type { StageDef } from "@/lib/stage-meta";

export type StageDefRow = StageDef & { id: string };

function StageRow({ def }: { def: StageDefRow }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: def.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style}>
        <StageDefForm def={def} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          {...attributes}
          {...listeners}
          type="button"
          className="cursor-grab text-faint active:cursor-grabbing"
          aria-label="Réordonner"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${def.dot}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{def.label}</p>
            {def.isWon && <Badge className="bg-emerald-50 text-emerald-700">Gagné</Badge>}
            {def.isLost && <Badge className="bg-rose-50 text-rose-700">Perdu</Badge>}
          </div>
          <p className="truncate text-xs text-muted">clé: {def.value}</p>
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Modifier
        </Button>
        {confirmingDelete ? (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await deleteStageDef(def.id);
                if (res.error) {
                  setError(res.error);
                  setConfirmingDelete(false);
                }
              })
            }
          >
            Confirmer ?
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
            Supprimer
          </Button>
        )}
      </div>
    </div>
  );
}

export function StageEditorList({ initial }: { initial: StageDefRow[] }) {
  const [stages, setStages] = useState(initial);
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = stages.findIndex((s) => s.id === active.id);
    const to = stages.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;
    const next = arrayMove(stages, from, to);
    setStages(next);
    void reorderStageDefs(next.map((s) => s.id));
  }

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={stages.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {stages.map((def) => (
              <StageRow key={def.id} def={def} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {adding ? (
        <StageDefForm onDone={() => setAdding(false)} />
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          + Ajouter une étape
        </Button>
      )}
    </div>
  );
}

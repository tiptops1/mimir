"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { PrioriteBadge, PotentielBadge } from "@/components/badges";
import { PIPELINE_STAGES, type StageValue } from "@/lib/constants";
import type { CardFieldKey, PipelineCardConfig } from "@/lib/tenant-config";

export interface PipelineCard {
  id: string;
  /** Values the card can surface; which ones show is driven by tenant config. */
  fields: Partial<Record<CardFieldKey, string | null>>;
  priorite: string | null;
  potentiel: string | null;
}

type Board = Record<StageValue, PipelineCard[]>;

const STAGE_VALUES = PIPELINE_STAGES.map((s) => s.value);

function CardView({
  card,
  config,
}: {
  card: PipelineCard;
  config: PipelineCardConfig;
}) {
  // Title falls back to the company name so a card is never blank (e.g. no contact yet).
  const title =
    card.fields[config.titleField] ?? card.fields.company ?? "—";
  const subtitle = card.fields[config.subtitleField] ?? "—";
  return (
    <div className="rounded-lg border border-border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <PrioriteBadge priorite={card.priorite} />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className={`text-xs ${config.subtitleClass}`}>{subtitle}</span>
        <PotentielBadge potentiel={card.potentiel} />
      </div>
    </div>
  );
}

function DraggableCard({
  card,
  config,
}: {
  card: PipelineCard;
  config: PipelineCardConfig;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`group cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="relative">
        <CardView card={card} config={config} />
        <Link
          href={`/companies/${card.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 hidden text-[11px] font-medium text-brand group-hover:block"
        >
          Ouvrir
        </Link>
      </div>
    </div>
  );
}

function Column({
  stage,
  cards,
  highlighted,
  config,
}: {
  stage: (typeof PIPELINE_STAGES)[number];
  cards: PipelineCard[];
  highlighted?: boolean;
  config: PipelineCardConfig;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.value });
  const colRef = useRef<HTMLDivElement>(null);

  // Scroll a deep-linked (highlighted) column into view on mount.
  useEffect(() => {
    if (highlighted)
      colRef.current?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
  }, [highlighted]);

  return (
    <div ref={colRef} className="flex h-full w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${stage.dot}`} />
          <span className="text-sm font-semibold">{stage.label}</span>
          {highlighted && (
            <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-medium text-white">
              Sélection
            </span>
          )}
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
          {cards.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`thin-scroll flex-1 space-y-2 overflow-y-auto rounded-xl border-2 border-t-4 ${stage.accent} p-2 transition-colors ${
          isOver
            ? "border-brand bg-indigo-50/40"
            : highlighted
              ? "border-brand bg-indigo-50/40 ring-2 ring-brand/40"
              : "border-border bg-slate-50/60"
        }`}
      >
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} config={config} />
        ))}
        {cards.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-slate-400">
            Déposez ici
          </p>
        )}
      </div>
    </div>
  );
}

export function PipelineBoard({
  initial,
  total,
  highlight,
  cardConfig,
}: {
  initial: Board;
  total: number;
  highlight?: StageValue | null;
  cardConfig: PipelineCardConfig;
}) {
  const [board, setBoard] = useState<Board>(initial);
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function stageOf(cardId: string): StageValue | null {
    for (const stage of STAGE_VALUES) {
      if (board[stage].some((c) => c.id === cardId)) return stage;
    }
    return null;
  }

  function onDragStart(event: DragStartEvent) {
    const from = stageOf(String(event.active.id));
    if (!from) return;
    setActiveCard(
      board[from].find((c) => c.id === event.active.id) ?? null,
    );
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const cardId = String(active.id);
    const from = stageOf(cardId);
    if (!from) return;

    // target column: either a stage id, or the stage of the card hovered
    const overId = String(over.id);
    const to = (STAGE_VALUES as string[]).includes(overId)
      ? (overId as StageValue)
      : stageOf(overId);
    if (!to || to === from) return;

    const card = board[from].find((c) => c.id === cardId);
    if (!card) return;

    const prev = board;
    setBoard({
      ...board,
      [from]: board[from].filter((c) => c.id !== cardId),
      [to]: [card, ...board[to]],
    });

    try {
      const res = await fetch(`/api/companies/${cardId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: to }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setBoard(prev);
      alert("Impossible de déplacer la société. Réessayez.");
    }
  }

  return (
    <div className="flex-1 overflow-hidden p-6">
      <p className="mb-3 text-sm text-muted">{total} sociétés au total</p>
      <DndContext
        id="avelior-pipeline"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="thin-scroll flex h-[calc(100vh-220px)] gap-4 overflow-x-auto pb-2">
          {PIPELINE_STAGES.map((stage) => (
            <Column
              key={stage.value}
              stage={stage}
              cards={board[stage.value]}
              highlighted={highlight === stage.value}
              config={cardConfig}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard ? (
            <div className="w-64 rotate-2">
              <CardView card={activeCard} config={cardConfig} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

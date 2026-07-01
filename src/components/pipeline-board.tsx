"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
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
import { PRIORITE_OPTIONS, POTENTIEL_OPTIONS } from "@/lib/constants";
import type { StageDef } from "@/lib/stage-meta";
import type { CardFieldKey, PipelineCardConfig } from "@/lib/tenant-config";

type StageValue = string;

export interface PipelineCard {
  id: string;
  /** Values the card can surface; which ones show is driven by tenant config. */
  fields: Partial<Record<CardFieldKey, string | null>>;
  priorite: string | null;
  potentiel: string | null;
  /** ISO date of the last touch (dernierContact or latest activity), if any. */
  lastTouch: string | null;
  /** Whether the company has at least one open follow-up task. */
  hasOpenTask: boolean;
  /** Lowercased haystacks for the board's client-side filters (all contacts). */
  search: { societe: string; nom: string; contact: string };
}

/** Compact days-since-last-touch label, warming as it goes stale. */
function touchChip(iso: string | null): { text: string; cls: string } | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  const text =
    days <= 0 ? "Aujourd'hui" : days === 1 ? "Hier" : `Il y a ${days} j`;
  const cls =
    days <= 7 ? "text-emerald-600" : days <= 30 ? "text-amber-600" : "text-rose-600";
  return { text, cls };
}

type Board = Record<StageValue, PipelineCard[]>;

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
  const touch = touchChip(card.lastTouch);
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <PrioriteBadge priorite={card.priorite} />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className={`text-xs ${config.subtitleClass}`}>{subtitle}</span>
        <PotentielBadge potentiel={card.potentiel} />
      </div>
      {(touch || card.hasOpenTask) && (
        <div className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-[11px]">
          {touch && <span className={touch.cls}>{touch.text}</span>}
          {card.hasOpenTask && (
            <span className="ml-auto inline-flex items-center gap-1 text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Relance
            </span>
          )}
        </div>
      )}
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
  stage: StageDef;
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
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
          {cards.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`thin-scroll flex-1 space-y-2 overflow-y-auto rounded-xl border-2 border-t-4 ${stage.accent} p-2 transition-colors ${
          isOver
            ? "border-brand bg-brand-subtle/40"
            : highlighted
              ? "border-brand bg-brand-subtle/40 ring-2 ring-brand/40"
              : "border-border bg-surface-2/60"
        }`}
      >
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} config={config} />
        ))}
        {cards.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-faint">
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
  stages,
}: {
  initial: Board;
  total: number;
  highlight?: StageValue | null;
  cardConfig: PipelineCardConfig;
  stages: StageDef[];
}) {
  const STAGE_VALUES = stages.map((s) => s.value);
  const [board, setBoard] = useState<Board>(initial);
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);
  const [fSociete, setFSociete] = useState("");
  const [fNom, setFNom] = useState("");
  const [fContact, setFContact] = useState("");
  const [fPriorite, setFPriorite] = useState("");
  const [fPotentiel, setFPotentiel] = useState("");
  const [fTask, setFTask] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Client-side filters — the cards are already loaded, so narrow instantly with
  // no server round-trip. All filters combine (AND). Text matches société /
  // contact name / email-phone; the selects match priorité / potentiel / whether
  // an open follow-up task exists. Drag-drop still operates on the full `board`.
  const s = fSociete.trim().toLowerCase();
  const n = fNom.trim().toLowerCase();
  const c = fContact.trim().toLowerCase();
  const filtering = Boolean(s || n || c || fPriorite || fPotentiel || fTask);
  const visible = useMemo<Board>(() => {
    if (!filtering) return board;
    const match = (card: PipelineCard) =>
      (!s || card.search.societe.includes(s)) &&
      (!n || card.search.nom.includes(n)) &&
      (!c || card.search.contact.includes(c)) &&
      (!fPriorite || card.priorite === fPriorite) &&
      (!fPotentiel || card.potentiel === fPotentiel) &&
      (!fTask || (fTask === "yes" ? card.hasOpenTask : !card.hasOpenTask));
    return Object.fromEntries(
      STAGE_VALUES.map((st) => [st, board[st].filter(match)]),
    ) as Board;
  }, [board, filtering, s, n, c, fPriorite, fPotentiel, fTask]);
  const shownCount = STAGE_VALUES.reduce((acc, st) => acc + visible[st].length, 0);

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
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-muted">
          {filtering
            ? `${shownCount} résultat${shownCount > 1 ? "s" : ""}`
            : `${total} sociétés au total`}
        </p>
        <div className="relative w-44">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={fNom}
            onChange={(e) => setFNom(e.target.value)}
            placeholder="Nom du contact…"
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand-subtle"
          />
        </div>
        <input
          value={fSociete}
          onChange={(e) => setFSociete(e.target.value)}
          placeholder="Société…"
          className="w-40 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand-subtle"
        />
        <input
          value={fContact}
          onChange={(e) => setFContact(e.target.value)}
          placeholder="Email / téléphone…"
          className="w-40 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand-subtle"
        />
        <select
          value={fPriorite}
          onChange={(e) => setFPriorite(e.target.value)}
          className="w-40 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-subtle"
        >
          <option value="">Toutes priorités</option>
          {PRIORITE_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={fPotentiel}
          onChange={(e) => setFPotentiel(e.target.value)}
          className="w-36 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-subtle"
        >
          <option value="">Tout potentiel</option>
          {POTENTIEL_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          value={fTask}
          onChange={(e) => setFTask(e.target.value)}
          className="w-44 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand-subtle"
        >
          <option value="">Relance : toutes</option>
          <option value="yes">Avec relance à faire</option>
          <option value="no">Sans relance</option>
        </select>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setFSociete("");
              setFNom("");
              setFContact("");
              setFPriorite("");
              setFPotentiel("");
              setFTask("");
            }}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            Réinitialiser
          </button>
        )}
      </div>
      <DndContext
        id="avelior-pipeline"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="thin-scroll flex h-[calc(100vh-220px)] gap-4 overflow-x-auto pb-2">
          {stages.map((stage) => (
            <Column
              key={stage.value}
              stage={stage}
              cards={visible[stage.value]}
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

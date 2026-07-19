/**
 * Le Bureau — pure translation from Mimir agent state to pixel-agents webview
 * messages (the vendored protocol's ServerMessage shapes, see
 * vendor/pixel-agents/core/src/messages.ts).
 *
 * Client-safe: no DB, no server imports. The frame component polls
 * /api/bureau/state and feeds snapshots through here.
 */

export interface BureauEvent {
  id: string;
  at: string; // ISO
  module: string;
  category: string;
  action: string;
}

export interface BureauSnapshot {
  pendingByModule: Record<string, number>;
  events: BureauEvent[]; // newest-first
}

export interface BureauTrackState {
  /** ISO timestamp of the newest event already animated. */
  lastEventAt: string | null;
  /** Modules currently showing the amber "awaiting approval" bubble. */
  permission: string[];
}

export interface TranslateResult {
  /** Messages to post to the webview immediately, in order. */
  immediate: Record<string, unknown>[];
  /** agentToolDone messages to post after a delay (lets the animation play). */
  delayed: { message: Record<string, unknown>; delayMs: number }[];
  next: BureauTrackState;
}

/** How long a character visibly types/reads for one ledger event. */
const TOOL_ANIMATION_MS = 5000;

/** Event verbs that read/retrieve → book animation; everything else types. */
const READING_RE = /retriev|ingest|read|scan|search|review|snapshot|health/i;

export function emptyTrackState(): BureauTrackState {
  return { lastEventAt: null, permission: [] };
}

export function translateSnapshot(
  snapshot: BureauSnapshot,
  prev: BureauTrackState,
  agentIdByModule: Record<string, number>,
): TranslateResult {
  const immediate: Record<string, unknown>[] = [];
  const delayed: TranslateResult["delayed"] = [];

  // 1. Pending-proposal bubbles (the Heimdallr "waiting for approval" signal).
  const pendingNow = Object.keys(agentIdByModule).filter(
    (m) => (snapshot.pendingByModule[m] ?? 0) > 0,
  );
  for (const m of pendingNow) {
    if (!prev.permission.includes(m)) {
      immediate.push({ type: "agentToolPermission", id: agentIdByModule[m] });
    }
  }
  for (const m of prev.permission) {
    if (!pendingNow.includes(m) && agentIdByModule[m] !== undefined) {
      immediate.push({ type: "agentToolPermissionClear", id: agentIdByModule[m] });
    }
  }

  // 2. New ledger events → tool animations, oldest first. On the very first
  // poll (lastEventAt null) nothing animates — history isn't replayed.
  let newestSeen = prev.lastEventAt;
  if (prev.lastEventAt === null) {
    newestSeen = snapshot.events[0]?.at ?? new Date(0).toISOString();
  } else {
    const fresh = snapshot.events
      .filter((e) => e.at > prev.lastEventAt!)
      .reverse(); // oldest → newest
    for (const e of fresh) {
      const id = agentIdByModule[e.module];
      if (id === undefined) continue; // system/unknown modules have no character
      const toolName = READING_RE.test(`${e.category} ${e.action}`) ? "Read" : "Write";
      immediate.push({
        type: "agentToolStart",
        id,
        toolId: e.id,
        status: `${e.category} · ${e.action}`,
        toolName,
      });
      delayed.push({
        message: { type: "agentToolDone", id, toolId: e.id },
        delayMs: TOOL_ANIMATION_MS,
      });
      if (e.at > (newestSeen ?? "")) newestSeen = e.at;
    }
  }

  return { immediate, delayed, next: { lastEventAt: newestSeen, permission: pendingNow } };
}

"use client";

import { useEffect, useRef } from "react";

import {
  emptyTrackState,
  translateSnapshot,
  type BureauSnapshot,
  type BureauTrackState,
} from "./translate";

interface BootPayload {
  agents: Record<string, number>;
  messages: Record<string, unknown>[];
}

const POLL_MS = 4000;

/**
 * Hosts the vendored pixel-agents SPA (static build at /bureau/index.html) in a
 * same-origin iframe. The SPA runs on its PostMessageTransport thanks to the
 * acquireVsCodeApi shim injected at build time (scripts/bureau-build.ts); this
 * component plays the server role: replay the frozen handshake from boot.json
 * on `webviewReady`, then poll /api/bureau/state and stream live agent activity.
 */
export function BureauFrame() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const delayTimers = new Set<ReturnType<typeof setTimeout>>();
    let boot: BootPayload | null = null;
    let track: BureauTrackState = emptyTrackState();
    let polling = false;

    const post = (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
    };

    const pollOnce = async () => {
      if (disposed || !boot || polling) return;
      polling = true;
      try {
        const res = await fetch("/api/bureau/state");
        if (!res.ok) return;
        const snapshot = (await res.json()) as BureauSnapshot;
        if (disposed) return;
        const { immediate, delayed, next } = translateSnapshot(snapshot, track, boot.agents);
        track = next;
        for (const m of immediate) post(m);
        for (const { message, delayMs } of delayed) {
          const t = setTimeout(() => {
            delayTimers.delete(t);
            post(message);
          }, delayMs);
          delayTimers.add(t);
        }
      } catch {
        // network hiccup — next tick retries
      } finally {
        polling = false;
      }
    };

    // The SPA may have sent webviewReady before this component mounted (the
    // iframe races Next hydration) — "bureau:drain" asks the build-time shim to
    // redeliver its outbound queue. `booted` keeps a redelivered webviewReady
    // from double-playing the handshake; an iframe reload resets it via onLoad.
    let booted = false;

    const drain = () => {
      iframeRef.current?.contentWindow?.postMessage("bureau:drain", window.location.origin);
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { source?: string; message?: { type?: string } } | null;
      if (data?.source !== "bureau") return;
      if (data.message?.type === "webviewReady" && !booted) {
        booted = true;
        track = emptyTrackState();
        void (async () => {
          if (!boot) {
            const res = await fetch("/bureau/boot.json");
            boot = (await res.json()) as BootPayload;
          }
          if (disposed) return;
          for (const m of boot.messages) post(m);
          void pollOnce();
          if (!pollTimer) pollTimer = setInterval(() => void pollOnce(), POLL_MS);
        })();
      }
      // Every other client message (focusAgent, saveLayout, settings…) is
      // intentionally ignored: the bureau is a read-only diorama.
    };

    const onFrameLoad = () => {
      booted = false; // fresh SPA instance → allow a fresh handshake
      drain();
    };
    const frame = iframeRef.current;
    frame?.addEventListener("load", onFrameLoad);

    window.addEventListener("message", onMessage);
    drain(); // cover the iframe-loaded-first race
    return () => {
      frame?.removeEventListener("load", onFrameLoad);
      disposed = true;
      window.removeEventListener("message", onMessage);
      if (pollTimer) clearInterval(pollTimer);
      for (const t of delayTimers) clearTimeout(t);
    };
  }, []);

  return (
    <iframe
      ref={iframeRef}
      src="/bureau/index.html"
      title="Le Bureau — les agents Mimir au travail"
      className="h-full w-full border-0"
    />
  );
}

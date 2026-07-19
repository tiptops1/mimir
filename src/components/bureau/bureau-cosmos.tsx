"use client";

import { useEffect, useRef, useState } from "react";

import { BUREAU_AGENTS } from "@/lib/bureau/agents";
import { cn } from "@/lib/utils";

interface BureauEvent {
  id: string;
  at: string;
  module: string;
  category: string;
  action: string;
}
interface BureauSnapshot {
  pendingByModule: Record<string, number>;
  events: BureauEvent[]; // newest-first
}

type AgentActivity = { atMs: number; label: string };

const POLL_MS = 4000;
// A little longer than the poll interval so an astronaut's glow bridges the
// gap between two ticks instead of flickering off right before the next one lands.
const ACTIVE_WINDOW_MS = 7000;

/** A small pixel-ish astronaut standing in for the agent — body is neutral, the
 * visor/backpack/perch take the agent's hue so it still reads as "that agent". */
function Astronaut() {
  return (
    <svg viewBox="0 0 24 30" className="bur-astro-svg" aria-hidden="true">
      <g className="bur-astro-leg bur-astro-leg-l">
        <rect x="7.5" y="19" width="3.6" height="8" rx="1.6" />
      </g>
      <g className="bur-astro-leg bur-astro-leg-r">
        <rect x="12.9" y="19" width="3.6" height="8" rx="1.6" />
      </g>
      <rect className="bur-astro-arm" x="2.4" y="10" width="3.4" height="9" rx="1.6" />
      <rect className="bur-astro-arm" x="18.2" y="10" width="3.4" height="9" rx="1.6" />
      <rect className="bur-astro-pack" x="8" y="8.5" width="8" height="12" rx="3" />
      <rect className="bur-astro-body" x="4.5" y="6" width="15" height="16" rx="7.5" />
      <ellipse className="bur-astro-visor" cx="12" cy="12.5" rx="6.2" ry="5.2" />
      <ellipse className="bur-astro-visor-shine" cx="9.8" cy="10.6" rx="1.6" ry="1" />
    </svg>
  );
}

/**
 * Le Bureau — the cosmos reskin (replaces the vendored pixel-office SPA). Each
 * Mimir agent is a small astronaut walking on its own perch, orbiting the sun;
 * polls /api/bureau/state and speeds an astronaut's walk + pops a tool-status
 * speech bubble when its module logs a ledger event, rings it amber while a
 * proposal awaits approval. Read-only diorama, same as the scene it replaced.
 */
export function BureauCosmos() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [activity, setActivity] = useState<Record<string, AgentActivity>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const mql = matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // Ticks the clock so "active" status expires client-side between polls.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/bureau/state");
        if (!res.ok || disposed) return;
        const snapshot = (await res.json()) as BureauSnapshot;
        if (disposed) return;
        setPending(
          Object.fromEntries(
            BUREAU_AGENTS.map((a) => [a.module, (snapshot.pendingByModule[a.module] ?? 0) > 0]),
          ),
        );
        setActivity((prev) => {
          const next = { ...prev };
          for (const e of snapshot.events) {
            const atMs = new Date(e.at).getTime();
            const current = next[e.module];
            if (!current || atMs > current.atMs) {
              next[e.module] = { atMs, label: `${e.category} · ${e.action}` };
            }
          }
          return next;
        });
      } catch {
        // network hiccup — next tick retries
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let stars: { x: number; y: number; r: number; p: number; s: number }[] = [];
    let raf = 0;

    function seed() {
      const dpr = window.devicePixelRatio || 1;
      const w = (canvas!.width = canvas!.offsetWidth * dpr);
      const h = (canvas!.height = canvas!.offsetHeight * dpr);
      const count = Math.floor((w * h) / 22000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: (Math.random() * 1.1 + 0.3) * dpr,
        p: Math.random() * Math.PI * 2,
        s: 0.35 + Math.random() * 0.65,
      }));
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const star of stars) {
        const tw = reduced ? 0.55 : 0.35 + 0.4 * Math.sin((t / 1600) * star.s + star.p);
        ctx!.globalAlpha = tw * 0.8;
        ctx!.fillStyle = "#cdd6e4";
        ctx!.beginPath();
        ctx!.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx!.fill();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    }

    seed();
    raf = requestAnimationFrame(draw);
    if (reduced) draw(0);

    const onResize = () => seed();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const selectedAgent = BUREAU_AGENTS.find((a) => a.module === selected) ?? null;

  return (
    <div className="bureau-cosmos" data-theme="dark">
      <canvas ref={canvasRef} className="bur-canvas" aria-hidden="true" />

      <div className="bur-stage-wrap">
        <div className="bur-stage">
          {BUREAU_AGENTS.map((a) => {
            const act = activity[a.module];
            const isActive = !!act && now - act.atMs < ACTIVE_WINDOW_MS;
            const isPending = !!pending[a.module];
            const angle = a.phase * 360;
            const frozenStyle = reduced
              ? {
                  transform: `rotate(${angle}deg) translateX(${a.radius}cqw) rotate(${-angle}deg)`,
                }
              : ({
                  ["--r" as string]: `${a.radius}cqw`,
                  ["--period" as string]: `${a.period}s`,
                  ["--delay" as string]: `${-(a.phase * a.period).toFixed(2)}s`,
                } as React.CSSProperties);

            return (
              <div
                key={a.module}
                className={cn("bur-orbit-track", !reduced && "bur-orbiting")}
                style={frozenStyle}
              >
                <button
                  type="button"
                  data-agent={a.module}
                  className={cn(
                    "bur-planet",
                    isActive && "is-active",
                    isPending && "is-pending",
                    selected === a.module && "is-selected",
                  )}
                  onClick={() => setSelected((cur) => (cur === a.module ? null : a.module))}
                  aria-label={a.name}
                >
                  <span className="bur-astro-wrap">
                    {isActive && act && <span className="bur-bubble">{act.label}</span>}
                    {isPending && <span className="bur-alert">!</span>}
                    <span className="bur-astronaut">
                      <Astronaut />
                    </span>
                  </span>
                  <span className="bur-planet-platform" />
                  <span className="bur-planet-label">{a.name}</span>
                </button>
              </div>
            );
          })}

          <div className="bur-sun" aria-hidden="true">
            <span className="bur-sun-caps">Mimir</span>
            <span className="bur-sun-role">Cœur du cosmos</span>
          </div>
        </div>

        <aside className="bur-panel" data-agent={selectedAgent?.module} aria-live="polite">
          {selectedAgent ? (
            <>
              <div className="p-agent">
                <span className="p-name">{selectedAgent.name}</span>
                <span
                  className={cn(
                    "p-status",
                    pending[selectedAgent.module]
                      ? "is-pending"
                      : activity[selectedAgent.module] &&
                          now - activity[selectedAgent.module].atMs < ACTIVE_WINDOW_MS
                        ? "is-active"
                        : "is-idle",
                  )}
                >
                  ●{" "}
                  {pending[selectedAgent.module]
                    ? "en attente d'approbation"
                    : activity[selectedAgent.module] &&
                        now - activity[selectedAgent.module].atMs < ACTIVE_WINDOW_MS
                      ? "en cours"
                      : "en veille"}
                </span>
              </div>
              <div className="p-role">{selectedAgent.role}</div>
              {activity[selectedAgent.module] && (
                <div className="p-last">{activity[selectedAgent.module].label}</div>
              )}
            </>
          ) : (
            <span className="p-hint">cliquez une planète pour voir l&apos;agent</span>
          )}
        </aside>
      </div>
    </div>
  );
}

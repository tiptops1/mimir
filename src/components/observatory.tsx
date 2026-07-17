"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Users, Radar, Wallet, Bot } from "lucide-react";
import type { RealmSlug } from "@/lib/realms";
import { cn } from "@/lib/utils";

export type ObservatoryRealm = {
  slug: RealmSlug;
  label: string;
  role: string;
  status: "live" | "planned";
  stats: { value: string; label: string }[];
  href?: string;
};

export type ObservatoryHub = {
  label: string;
  caption: string;
  stat: string;
};

type ObservatoryProps = {
  realms: ObservatoryRealm[];
  hub: ObservatoryHub;
  tenantLabel: string;
};

const ICONS: Record<RealmSlug, typeof Users> = {
  relation: Users,
  chasse: Radar,
  tresor: Wallet,
  mimir: Bot,
};

// Percent positions on the 1180x620 stage. Not a symmetric diamond: the
// instrument panel occupies the bottom-right corner (right:28px, bottom:26px,
// width 308px), so nothing can sit there — mimir goes bottom-center instead.
const POSITIONS: Record<RealmSlug, { left: string; top: string }> = {
  relation: { left: "18%", top: "20%" },
  chasse: { left: "82%", top: "20%" },
  tresor: { left: "18%", top: "80%" },
  mimir: { left: "50%", top: "90%" },
};

// Thread paths in the 1180x620 viewBox, endpoints matching POSITIONS above,
// curving toward the hub at (590, 329) — see .obs-well's left:50%/top:53%.
const THREADS: Record<RealmSlug, string> = {
  relation: "M212,124 Q420,170 590,329",
  chasse: "M968,124 Q760,170 590,329",
  tresor: "M212,496 Q420,440 590,329",
  mimir: "M590,558 Q590,450 590,329",
};

export function Observatory({ realms, hub, tenantLabel }: ObservatoryProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pinned, setPinned] = useState<RealmSlug | null>(null);
  const [hovered, setHovered] = useState<RealmSlug | null>(null);
  const [clock, setClock] = useState("");

  const activeSlug = pinned ?? hovered ?? realms[0]?.slug ?? null;
  const active = useMemo(
    () => realms.find((r) => r.slug === activeSlug) ?? null,
    [realms, activeSlug],
  );

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  }, []);

  return (
    <div className="observatory" style={{ ["--page-bg" as string]: "var(--background)" }}>
      <div className="obs-scene" data-theme="dark">
        <canvas ref={canvasRef} className="observatory-canvas" aria-hidden="true" />

        <div className="obs-plate">
          <span className="obs-wordmark">
            M<b>i</b>mir
          </span>
          <span className="obs-sub">Cosmos · aperçu</span>
          <div className="obs-right">
            <span className="obs-tenant">{tenantLabel}</span>
            {clock && <span>{clock}</span>}
          </div>
        </div>

        <div className="obs-stage-wrap">
          <div className="obs-stage">
            <svg
              className="obs-threads"
              viewBox="0 0 1180 620"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <ellipse cx="590" cy="329" rx="435" ry="205" />
              <ellipse cx="590" cy="329" rx="300" ry="132" transform="rotate(-8 590 329)" />
              {realms.map((r) => (
                <path
                  key={r.slug}
                  className={cn("flow", activeSlug === r.slug && "bright")}
                  data-realm={r.slug}
                  d={THREADS[r.slug]}
                />
              ))}
            </svg>

            <div className="obs-ring" aria-hidden="true" />

            <div className="obs-well">
              <span className="obs-caps">{hub.label}</span>
              <span className="obs-role">{hub.caption}</span>
              <span className="obs-stat">{hub.stat}</span>
            </div>

            {realms.map((r) => {
              const Icon = ICONS[r.slug];
              const pos = POSITIONS[r.slug];
              return (
                <button
                  key={r.slug}
                  type="button"
                  data-realm={r.slug}
                  data-theme="dark"
                  className={cn("obs-realm", pinned === r.slug && "pinned")}
                  style={{ left: pos.left, top: pos.top }}
                  onMouseEnter={() => setHovered(r.slug)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(r.slug)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setPinned((p) => (p === r.slug ? null : r.slug))}
                >
                  <span className="obs-orb">
                    <Icon />
                  </span>
                  <span className="obs-name">{r.label}</span>
                  <span className="obs-role">{r.role}</span>
                  <span
                    className={cn(
                      "obs-status",
                      r.status === "live" ? "is-live" : "is-planned",
                    )}
                  >
                    <i />
                    {r.status === "live" ? "en production" : "planifié"}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="obs-hint">survolez un royaume · cliquez pour épingler</div>

          <aside
            className="obs-panel"
            data-realm={active?.slug}
            data-theme="dark"
            aria-live="polite"
          >
            {active && (
              <>
                <div className="p-realm">
                  <span className="p-name" style={{ color: "var(--realm)" }}>
                    {active.label}
                  </span>
                  <span
                    className="p-status"
                    style={{
                      color:
                        active.status === "live" ? "var(--realm)" : "var(--faint)",
                    }}
                  >
                    ● {active.status === "live" ? "en production" : "planifié"}
                  </span>
                </div>
                <div className="p-role">{active.role}</div>
                {active.stats.length > 0 && (
                  <div className="p-stats">
                    {active.stats.map((s) => (
                      <div className="p-stat" key={s.label}>
                        <div className="v">{s.value}</div>
                        <div className="k">{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}
                {active.href ? (
                  <Link href={active.href} className="p-enter">
                    Entrer dans le royaume
                  </Link>
                ) : (
                  <span className="p-soon">Bientôt</span>
                )}
              </>
            )}
          </aside>
        </div>

        <div className="obs-fade" aria-hidden="true" />
      </div>
    </div>
  );
}

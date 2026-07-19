import type { Metadata } from "next";

import { BureauFrame } from "@/components/bureau/bureau-frame";

export const metadata: Metadata = { title: "Le Bureau — Mimir" };

/**
 * C5 easter egg — hidden route (not in REALMS/NAV; reached via the sidebar
 * glyph egg). The vendored pixel-agents office renders the Mimir agents at
 * work. The scene is always dark, like the observatory hero.
 */
export default function BureauPage() {
  return (
    <div className="flex h-full flex-col p-6">
      <div
        data-theme="dark"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        <div className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-3.5">
          <h1
            className="text-xl font-semibold tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Le Bureau
          </h1>
          <p className="text-xs text-muted">
            Les agents de Mimir au travail — vous avez trouvé l&apos;œuf.
          </p>
        </div>
        <div className="min-h-[480px] flex-1">
          <BureauFrame />
        </div>
      </div>
    </div>
  );
}

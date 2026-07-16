# Cosmos mechanics — implementation recipes

Verified against the Next 16 docs bundled in this repo
(`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`). `<ViewTransition>` comes
from `react` (App Router ships the canary), and animations only fire inside React Transitions —
route navigations qualify automatically.

## 1. Realm layer

### realms.ts (single source of truth)

```ts
// src/lib/realms.ts
export type Realm = {
  slug: "relation" | "chasse" | "tresor" | "mimir";
  label: string;            // sidebar group heading (French)
  routes: string[];         // first path segments owned by the realm
};

export const REALMS: Realm[] = [
  { slug: "relation", label: "Relation", routes: ["dashboard", "todo", "companies", "contacts", "pipeline"] },
  { slug: "chasse",   label: "Chasse",   routes: ["leadone", "outreach", "inbox"] },
  { slug: "tresor",   label: "Trésor",   routes: ["finances", "analytics"] },
  { slug: "mimir",    label: "Mimir",    routes: ["heimdallr"] },
];

export function realmForPath(pathname: string): Realm["slug"] | undefined {
  const seg = pathname.split("/")[1];
  return REALMS.find((r) => r.routes.includes(seg))?.slug;
}
```

Hue values live in CSS (below), keyed by the slug — components never import colors.

### Realm tokens in globals.css

Mirror the theme-token pattern: semantic names, per-realm swap, dark overrides. Default (no
`data-realm`, e.g. settings/login) falls back to brand.

```css
:root {
  --realm: var(--brand);
  --realm-subtle: var(--brand-subtle);
  --realm-ring: var(--ring);
}
[data-realm="chasse"] {
  --realm: #0891b2;                        /* cyan-600 */
  --realm-subtle: #ecfeff;
  --realm-ring: rgba(8, 145, 178, 0.4);
}
[data-realm="tresor"] {
  --realm: #059669;                        /* emerald-600 */
  --realm-subtle: #ecfdf5;
  --realm-ring: rgba(5, 150, 105, 0.4);
}
[data-realm="mimir"] {
  --realm: #d97706;                        /* amber-600 */
  --realm-subtle: #fffbeb;
  --realm-ring: rgba(217, 119, 6, 0.4);
}
/* dark: brighter inks, translucent fills — same pattern as the theme block.
   NOTE data-theme is on <html>, data-realm on the shell wrapper below it, so
   these MUST be descendant selectors — a compound [a][b] never matches. */
[data-theme="dark"] [data-realm="chasse"] {
  --realm: #22d3ee;
  --realm-subtle: rgba(6, 182, 212, 0.16);
  --realm-ring: rgba(34, 211, 238, 0.45);
}
[data-theme="dark"] [data-realm="tresor"] {
  --realm: #34d399;
  --realm-subtle: rgba(16, 185, 129, 0.16);
  --realm-ring: rgba(52, 211, 153, 0.45);
}
[data-theme="dark"] [data-realm="mimir"] {
  --realm: #fbbf24;
  --realm-subtle: rgba(245, 158, 11, 0.16);
  --realm-ring: rgba(251, 191, 36, 0.45);
}
```

Expose to Tailwind in the existing `@theme inline` block:

```css
--color-realm: var(--realm);
--color-realm-subtle: var(--realm-subtle);
```

Realm-scoped focus + selection (inside a realm, the light follows you):

```css
[data-realm] :focus-visible { outline-color: var(--realm-ring); }
[data-realm] ::selection { background: var(--realm-subtle); color: var(--realm); }
```

### Setting data-realm

Client wrapper in the `(app)` layout (the attribute must track the URL):

```tsx
// src/components/realm-scope.tsx
"use client";
import { usePathname } from "next/navigation";
import { realmForPath } from "@/lib/realms";

export function RealmScope({ children }: { children: React.ReactNode }) {
  const realm = realmForPath(usePathname());
  return <div data-realm={realm} className="contents">{children}</div>;
}
```

(`className="contents"` keeps it out of layout. Putting the attribute on `<html>` via effect
would flash on first paint — the wrapper renders it server-consistent.)

### Grouped sidebar

Group `NAV` items by realm; heading style matches table headers; active state reads realm
tokens instead of brand:

```tsx
<p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-faint">
  {realm.label}
</p>
{/* active item: */}
<span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-realm" />
<Icon className={active ? "text-realm" : "text-faint group-hover:text-muted"} />
```

The sidebar sits inside `RealmScope`, so its accent tracks the realm you're *in*.

## 2. Continuity (view transitions)

### Enable

```ts
// next.config.ts
const nextConfig: NextConfig = { experimental: { viewTransition: true } };
```

### Anchor the shell (fixed stars)

```tsx
<aside style={{ viewTransitionName: "cosmos-sidebar" }}>…</aside>
<header style={{ viewTransitionName: "cosmos-topbar" }}>…</header>
```

```css
::view-transition-group(cosmos-sidebar),
::view-transition-group(cosmos-topbar) { animation: none; z-index: 100; }
::view-transition-old(cosmos-sidebar), ::view-transition-old(cosmos-topbar) { display: none; }
::view-transition-new(cosmos-sidebar), ::view-transition-new(cosmos-topbar) { animation: none; }
```

### Realm shift (crossing universes)

Tag sidebar links so realm crossings carry a type; same-realm navs get none:

```tsx
<Link href={item.href} transitionTypes={crossesRealm ? ["realm-shift"] : []}>
```

Wrap the routed content (in the `(app)` layout, inside `RealmScope`):

```tsx
import { ViewTransition } from "react";

<ViewTransition
  enter={{ "realm-shift": "realm-shift", default: "none" }}
  exit={{ "realm-shift": "realm-shift", default: "none" }}
  default="none"
>
  {children}
</ViewTransition>
```

```css
::view-transition-old(.realm-shift) {
  animation: 150ms ease-in both cosmos-fade reverse;
}
::view-transition-new(.realm-shift) {
  animation: 210ms ease-out 150ms both cosmos-fade, 360ms ease-in-out both cosmos-rise;
}
@keyframes cosmos-fade { from { opacity: 0; filter: blur(3px); } to { opacity: 1; filter: blur(0); } }
@keyframes cosmos-rise { from { transform: translateY(8px); } to { transform: translateY(0); } }
```

The hue sweep is free: `data-realm` changes with the route, and the aura/accent colors
transition via `transition: background-color 300ms ease` on the aura element (below). Old
content leaves fast, new content arrives under new light.

### Deeper / back (within a realm)

List → detail links: `transitionTypes={["nav-forward"]}`; back links `["nav-back"]` — use the
60px directional-slide CSS from the Next guide verbatim (`nav-forward` slides left,
`nav-back` right). Keep it for realm-internal navigation only; realm crossings use the shift.

### Shared-element morph (row → detail header)

```tsx
// list row
<ViewTransition name={`company-${c.id}`}>
  <span className="font-medium text-foreground">{name}</span>
</ViewTransition>

// detail page header
<ViewTransition name={`company-${company.id}`}>
  <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
</ViewTransition>
```

Morph names must be unique per entity (`company-{id}`). Don't morph whole cards — morph the
identity element (the name), let the rest crossfade; whole-card morphs read as smearing.

### Suspense reveal (loading handoff)

```tsx
<Suspense fallback={
  <ViewTransition exit="slide-down"><TableSkeleton /></ViewTransition>
}>
  <ViewTransition enter="slide-up" default="none"><CompaniesTable /></ViewTransition>
</Suspense>
```

Use the guide's `slide-down`/`slide-up` keyframes (150ms exit, 210ms delayed enter).

### Reduced motion (non-negotiable)

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*), ::view-transition-new(*), ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
```

## 3. Atmosphere

### PageHeader aura

One radial gradient, realm-subtle, so faint it disappears on screenshots of a busy page:

```tsx
<div className="relative flex flex-wrap items-end justify-between gap-3 overflow-hidden border-b border-border bg-card px-4 py-5 sm:px-6">
  <div
    aria-hidden
    className="pointer-events-none absolute -top-24 right-[-10%] h-56 w-[45%] rounded-full opacity-60 blur-3xl transition-colors duration-300"
    style={{ background: "radial-gradient(closest-side, var(--realm-subtle), transparent)" }}
  />
  {/* existing header content, now relative z-[1] */}
</div>
```

### Charts

Recharts primary series: `stroke="var(--realm)"` / `fill="var(--realm-subtle)"` — charts in
Trésor glow emerald, in Chasse cyan, without touching chart code per page.

## Verification notes for design-review

- Realm shift: navigate Relation → Trésor; content crossfades, aura sweeps, sidebar/topbar do
  not move. Back button: no directional slide (browser back carries no type) — that's expected.
- Contrast: every `--realm` ink on `--surface` ≥ 4.5:1 in BOTH themes (the dark values above
  are pre-brightened for this — re-check if you change hues).
- Safari renders some VT animations differently; the app must be fully usable with zero
  animation (it degrades to instant swaps).

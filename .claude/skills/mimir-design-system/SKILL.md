---
name: mimir-design-system
description: The Mimir/Vision RM design system — semantic tokens, ui.tsx primitives, canonical table/filter/popover markup, dark-mode rules, and the product's hard UI laws. ALWAYS consult before writing or restyling ANY UI in the mimir repo — a new page, a component, a table, a filter bar, a badge, a dashboard, a form, an agent-facing surface — even a "quick" visual tweak or a single className change. Also use when reviewing UI, choosing colors, or debugging dark-mode rendering.
---

# Mimir design system

The visual identity is **Linear-refined**: border-first elevation (hairlines carry structure,
shadows are garnish), one accent per context used sparingly, high information density, quiet
motion. High-end here means *restraint + consistency*, not decoration. When in doubt, remove
color, remove shadow, tighten spacing.

The experience direction on top of this system — realms with their own accent hue, view
transitions between routes, header auras — is the `mimir-cosmos` skill. Consult it for anything
touching navigation, sections, or route-level motion; it extends these rules, never breaks them.

**UI copy is French** — every label, placeholder, empty state, and button the demo tenant sees
is French (the vocabulary itself is tenant config, per mimir-conventions rule 2). Don't ship
English strings on product surfaces.

## Tokens — the only colors that exist

All colors are semantic CSS variables defined in `src/app/globals.css` and mapped to Tailwind
utilities via `@theme inline`. Dark mode is a token swap on `[data-theme="dark"]` — **if you only
use tokens, dark mode is automatic and free**. Writing `bg-white`, `text-slate-500`, or any
literal hue is how dark mode breaks; there is no other way it breaks.

| Role | Utilities |
|---|---|
| Canvas / cards / raised-hover | `bg-background` / `bg-card` / `bg-surface-2` |
| Text: primary / secondary / tertiary | `text-foreground` / `text-muted` / `text-faint` |
| Lines | `border-border`, `border-border-strong` (only when a divider must read) |
| Accent | `bg-brand`, `hover:bg-brand-hover`, `bg-brand-subtle` (active nav/selection), `text-on-brand` |
| Semantic fg + subtle fill pairs | `success`/`success-subtle`, `warning`/…, `danger`/…, `info`/… |
| Radii | `rounded-md` (6px) inner elements · `rounded-lg` (8px) buttons/inputs/popovers · `rounded-xl` (12px) cards |
| Elevation | `shadow-xs` resting cards/buttons · `shadow-lg` floating layers. Nothing in between without a reason. |

**The one sanctioned exception:** stage/priority badge classes are *data* (e.g.
`StageDefinition.badgeClass` stores `"bg-sky-100 text-sky-700"`). Leave them literal — a dark
compat layer in `globals.css` remaps those hues. If you introduce a new literal hue in badge
*data*, add its remap to that layer or it will glow radioactive in dark mode.

## Primitives — never restyle raw elements

`src/components/ui.tsx` exports the atoms. Composing them is the default; a bare `<button>` or
`<input>` with ad-hoc classes is a defect unless it's genuinely a new primitive (then it belongs
in `ui.tsx`).

- `Card` / `CardHeader` / `CardTitle` / `CardBody` — the only panel. Header is `px-5 py-3.5`
  with a 13px semibold title; body is `p-5`.
- `Button` / `LinkButton` — variants `primary | secondary | ghost | danger`, sizes `sm | md`.
  One primary action per view; everything else is `secondary` or `ghost`.
- `Badge` — pill; pass `tone` for semantic colors, or explicit classes when the color is data.
- `Input` / `Textarea` / `Select` / `Label` — the form field system (h-9, focus ring built in).
- `EmptyState` — dashed-border card with title + hint. Every list/table renders this when empty;
  never a bare "No results" paragraph.

Icons are **lucide-react**, almost always `h-4 w-4`, tinted `text-faint` or `text-muted`.

## Canonical composite patterns

Copy the markup from `references/patterns.md` rather than re-deriving it. The catalog covers:
page skeleton, the canonical table, filter bars, popover menus, inline-edit cells, notice
banners, and the floating action bar. Summary of what's canonical and where it lives:

- **Page skeleton** — `PageHeader` (`src/components/page-header.tsx`) with actions as children,
  then content in `p-6`. List pages: `SavedViews` → filters → table.
- **Tables** — the refined variant from `src/app/(app)/companies/page.tsx:220` is canonical
  (header row `bg-surface-2/60 text-[11px] uppercase tracking-wider text-faint`, cells
  `px-4 py-2.5/py-3`, row hover `hover:bg-surface-2/70`). Older pages use a looser variant —
  don't copy those; migrate opportunistically.
- **Filter bars** — `useUrlFilters` (`src/lib/use-url-filters.ts`): debounced text inputs,
  immediate selects, ghost "Réinitialiser" shown only when filters are active. See
  `contacts-filters.tsx`. Field order law: **contact name, company, email, then the rest.**
- **Popovers/menus** — `rounded-lg border border-border bg-card p-1.5 shadow-lg` + `animate-pop`,
  outside-click close. See `quick-add-menu.tsx`, `enum-cell.tsx`.
- **Inline editing** — table cells edit in place via badge-→-dropdown (`enum-cell.tsx`) with
  optimistic local state + `useTransition`; no navigation, **no page scroll on select**.
- **Floating bars** — bulk actions / sticky save: `bg-card/95 backdrop-blur shadow-lg rounded-xl`
  (`bulk-select.tsx:153`, `company-inline-editor.tsx:249`).

## Type & density scale

Base is `text-sm`. Step down, never up: `text-xl font-semibold tracking-tight` page titles ·
13px card titles and `sm` buttons · `text-xs` secondary/meta · 11px uppercase table headers.
Any number a user might compare (money, counts, dates in tables) gets `.tnum`. Density is a
feature — resist padding inflation; `py-3` table cells and `p-5` card bodies are the ceiling.

## Motion

Quiet and fast: `duration-100` transitions on interactive elements, `active:translate-y-px` on
buttons (built into the primitive), `animate-pop` (120ms) for anything that floats in,
`animate-drawer` for the mobile sidebar. In-page element motion stays ≤ ~180ms and nothing
animates spontaneously at rest. *Route-level* motion (view-transition morphs, realm shifts,
Suspense reveals, up to 400ms) is governed by the `mimir-cosmos` skill — don't hand-roll it.

## Hard product laws (violating these = rework, not opinion)

1. Every list page gets **comprehensive filters**; filter order is contact name, company, email, then the rest.
2. **City is never surfaced.** Anywhere.
3. Contact-field display priority: company, revenue, website, decision-maker, email, linkedin, phone.
4. **Selecting or clicking must never scroll the page** — no autofocus-that-scrolls, no anchor jumps.
5. Empty, loading (disabled/`opacity-50` + pending state), and hover states are part of the
   feature, not polish to defer.

## Definition of done for any UI change

Before calling UI work finished: it uses tokens + primitives only (grep your diff for `slate-`,
`gray-`, `white`, `black` — hits outside badge data are bugs); it reads correctly in **both
themes** (toggle is in the topbar); the table/filter/popover markup matches the canonical
patterns; keyboard focus is visible (`focus-visible` ring is global — don't suppress it); and
mobile (~375px) doesn't overflow horizontally. Verify visually with the `mimir-verify` skill.

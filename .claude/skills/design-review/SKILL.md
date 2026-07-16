---
name: design-review
description: Visual QA pass for Mimir UI work — screenshot every changed surface in light + dark and desktop + mobile, grade it against a concrete pass/fail checklist (tokens, states, density, canonical markup, contrast, focus), fix failures, and re-check. Use whenever UI work is about to be called done in the mimir repo, when the user says "design review", "polish this", "does it look right/high-end", "check the UI", or before shipping any change that renders something. Not for non-UI changes.
---

# Design review — Mimir

Turns "looks fine to me" into a graded pass/fail list with screenshot proof. Run it after the
feature works, before calling it done. The grading criteria come from the `mimir-design-system`
skill — load that first if it isn't already in context.

## 1. Scope the review

List the surfaces the diff actually touches — `git diff --name-only` (or the session's edits) →
map components to the routes that render them. Review only those surfaces; don't screenshot-tour
the whole app.

## 2. Get eyes on it

Follow the `mimir-verify` skill: `preview_start {name: "mimir-dev"}` (port 3001), log in as the
crm_demo admin at `/login`. One login per session — the cookie persists.

**Theme flipping:** the app themes off `data-theme` on `<html>`, NOT `prefers-color-scheme`, so
`resize_window {colorScheme}` does nothing. Flip with javascript_tool:

```js
document.documentElement.dataset.theme = "dark";   // dark
delete document.documentElement.dataset.theme;      // light
```

(No reload needed — tokens swap live.)

## 3. The matrix

Per surface, capture in this order (light/desktop is the home theme — judge composition there,
then check the variants for breakage):

| Pass | Setup | Looking for |
|---|---|---|
| Light · desktop | 1280×800 | composition, density, hierarchy |
| Dark · desktop | flip `data-theme` | un-tokened colors glowing, illegible badge data, lost borders |
| Light · mobile | `resize_window {preset: "mobile"}` | horizontal overflow, filter bar wrapping, tables scrolling in-card |
| Interaction | click/hover/type the new elements | popover placement, hover fills, focus ring, **page must not scroll on select** |

Also run `read_console_messages {onlyErrors: true}` once — hydration warnings and 404'd assets
count as failures.

## 4. Grade — the checklist

Each item is pass/fail per surface. Verify in code where code is the evidence (grep the diff),
in the browser where pixels are the evidence.

**Tokens & theming**
- [ ] No literal colors in the diff: `git diff | grep -E 'slate-|gray-|zinc-|white|black|#[0-9a-fA-F]{3,6}'` — hits outside badge *data* fail.
- [ ] Dark mode: every element legible, borders visible, no white flash panels.
- [ ] New badge-data hues (if any) added to the dark compat layer in `globals.css`.

**Structure & idiom**
- [ ] Uses `ui.tsx` primitives — no ad-hoc `<button>`/`<input>` styling.
- [ ] Tables/filters/popovers match the canonical markup in `mimir-design-system` `references/patterns.md` (11px uppercase `text-faint` table headers on `bg-surface-2/60`, `animate-pop` popovers, etc.).
- [ ] Filter bar order: contact name, company, email, then the rest. City appears nowhere.
- [ ] One primary button per view; the rest secondary/ghost.

**States (features, not polish)**
- [ ] Empty state renders `EmptyState` with a French title + hint — trigger it with a filter that matches nothing.
- [ ] Pending/loading: actions disable (`opacity-50`) while a transition is in flight.
- [ ] Row/element hover fill present (`hover:bg-surface-2/70` on table rows).
- [ ] Tab to the new controls: the global `focus-visible` ring shows (not suppressed).

**Type & density**
- [ ] Scale respected: `text-sm` base, `text-xs` meta, nothing invented (a stray `text-base`/`text-lg` in a table is a fail).
- [ ] Comparable numbers (money, counts, table dates) carry `.tnum`.
- [ ] Spacing matches neighbors: `px-4 py-3` cells, `p-5` card bodies, `gap-3` filter bars — no padding inflation.

**Copy**
- [ ] All user-visible strings French; tenant-specific vocabulary comes from config, not literals.

## 5. Report, fix, re-check

Report as a table: surface × item → ✅/❌, one line of evidence per ❌ (screenshot region or
file:line). Then fix every ❌ in source (never patch via javascript_tool), reload, and re-run
only the failed cells. Finish with one light + one dark screenshot per surface as proof.

A review with zero ❌ on the first pass is suspicious — look again at dark mode and the empty
state, the two most-skipped cells.

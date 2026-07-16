---
name: mimir-cosmos
description: The Mimir experience direction — the app as one cosmos of distinct realms (module universes with their own accent identity) connected by continuous motion (view transitions, shared-element morphs, persistent shell) instead of rigid page-per-page cuts. Consult whenever building navigation, page transitions, a new module/section, the sidebar, dashboards, or anything where "how it feels to move through the app" matters; whenever the user says vibrant, flow, continuity, cosmos, universe, realm, alive, or immersive; and before adding any route-level animation.
---

# Mimir cosmos — one universe, many realms

The target feeling: the CRM is not a stack of pages, it is **one cosmos you move through**.
Each module is a **realm** — a universe with its own light — and navigation is **travel**, not
replacement. Nothing hard-cuts; things morph, slide, and shift hue. The Norse module names
(Heimdallr, Huginn, Nornir, Bragi, Forseti…) aren't just labels — realms make them felt.

This *extends* `mimir-design-system`; it never overrides it. Shared physics stay absolute:
same tokens, spacing, radii, type scale, density in every realm. Realms differ in **hue and
atmosphere only**. Vibrancy comes from light and motion, not from decoration or louder
components. If a realm change makes a button look different, that's a physics violation.

## The three laws

1. **Shared physics, local light.** One design system everywhere; each realm swaps a small
   accent-token layer (`--realm`, `--realm-subtle`, `--realm-ring`) the way dark mode swaps
   theme tokens. Global chrome (sidebar shell, auth, settings) keeps neutral `--brand`.
2. **Travel, never teleport.** Every navigation communicates its meaning through motion
   (Next 16 `<ViewTransition>` — supported, behind `experimental.viewTransition`):
   - *Deeper into a realm* (list → detail): **shared-element morph** — the row's name morphs
     into the detail header. "Same thing, closer."
   - *Within a realm* (tabs, filters, pagination): **crossfade in place**. "Same place,
     different content."
   - *Crossing realms* (sidebar jump): **realm shift** — content crossfades while the realm
     accent and header aura sweep to the new hue. The color change IS the transition; the user
     feels the border crossing.
   - *Back*: reverse of the way in. The sidebar and topbar are **anchored** — they never
     animate; they are the fixed stars you navigate by.
3. **The cosmos stays quiet.** Motion budget is unchanged: ≤ 400ms morphs, 150/210ms
   exit/enter, nothing loops, nothing bounces, `prefers-reduced-motion` collapses everything
   to instant swaps. Vibrant ≠ busy: at rest the app is as calm as before — the life shows
   when you *move*.

## Realms are config, not code

Realm definitions live in one place — `src/lib/realms.ts` (create it): slug, label, routes,
lucide icon, and hue tokens for both themes. Modules join the cosmos by adding an entry, never
by sprinkling colors in components. Suggested starting map (adjust with the user, not silently):

| Realm | Routes | Character / hue |
|---|---|---|
| **Relation** (the core) | dashboard, todo, companies, contacts, pipeline | indigo — the existing brand |
| **Chasse** (the hunt) | leadone, outreach, inbox | cyan — radar, signal, pursuit |
| **Trésor** | finances, analytics | emerald — value, growth |
| **Mimir** (agent realms, S7+) | heimdallr, huginn, … | amber — vigilance, the watchman's fire; each module may later earn its own hue |

Sidebar renders nav **grouped by realm** (small `text-faint` uppercase realm labels), and the
active item's accent bar/icon take the realm hue instead of flat `--brand`.

## Atmosphere — where realm light is allowed

Exactly these surfaces, nothing else: the sidebar active state · a soft radial **aura** in the
`PageHeader` (realm-subtle, barely-there gradient) · focus rings and `::selection` within the
realm · chart primary series · the realm-shift transition itself. Body text, cards, tables,
buttons stay neutral — the realm is the sky, not the furniture.

## Build path (phased — each phase ships alone)

1. **Realm layer**: `realms.ts` + `data-realm` attribute on the app shell (set from the route
   segment) + realm token CSS in `globals.css` (light + dark values) + grouped sidebar.
2. **Continuity**: enable `experimental.viewTransition`; anchor sidebar/topbar; realm-shift
   crossfade on realm crossings; in-realm crossfades.
3. **Morphs**: list-row → detail-header shared elements on companies, contacts, deals;
   Suspense skeleton reveals.
4. **Atmosphere**: header auras, realm-tinted charts, `::selection`.

Implementation recipes (CSS + TSX for every mechanism above) are in `references/mechanics.md` —
copy from there rather than re-deriving. After any phase, run `design-review` and check the
transitions at both themes; a realm hue that fails contrast in dark mode fails the review.

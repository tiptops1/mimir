---
name: mimir-conventions
description: Non-negotiable engineering rules for the Mimir repo (agentic platform on the Vision RM baseline). ALWAYS consult before writing code, running db:push, or writing a Mongo/Prisma query in the mimir repo. Supersedes the global vision-rm-conventions skill here — this repo has no production user, but must never touch the prod cluster. Trigger on any work in mimir/ or mention of Heimdallr, Mimisbrunnr, Huginn, Muninn, Nornir, Bragi, Forseti.
---

# Mimir conventions

This repo is the **Mimir agentic platform**, seeded from Vision RM (`avelior-analytics` @
`719f842`) as a baseline. Key docs: `docs/mimir/roadmap.md` (session plan, cross-session memory),
`docs/mimir/AGENTIC-PLATFORM-DECISION-MEMO.md` (decisions D1–D5, gates G1/G2),
`docs/mimir/decisions.md` (decision log), `docs/VISION-RM-BRIEF.md` (what the baseline is).

## What replaces "don't break the live app"

There is **no production user here**. The top constraint is instead:
**never point this repo at the prod cluster** (host contains `crm-railway`). Run the
`mimir-env-guard` skill before anything data-touching. Everything else is a staging environment —
experiments are cheap, that's the point of the split.

## The standing rules (memo §7 — agentic modules will test every one)

1. **Config, not code — now including prompts.** Prompt templates are tenant config (alongside
   `FieldDefinition`), seeded per vertical. A broker-specific phrase in a `.ts` file is a violation.
2. **Generic ontology, vertical labels.** Model names stay generic (knowledge base, conversations,
   playbooks); French broker vocabulary lives in labels/config — the stage-definition pattern.
3. **Tenant data only through the DB router** (`getTenantDb()` in `src/lib/tenant-context.ts`).
   Agent steps too. Never a hardcoded DB name or connection string.
4. **One bridge:** every side-effectful agent action goes through the Heimdallr ledger (from S7 on).
   No module ships its own approval flow (D5).
5. **Events from day one.** Emit structured events immediately; dashboards later. Events cannot be
   backfilled.
6. **Additive-only schema changes** — kept as discipline even though Mimir is a permanent parallel
   platform (see decisions.md); it keeps Vision RM cherry-picks clean.

## Inherited invariants (unchanged from the baseline)

- **The Mongo `isSet` trap:** a filter `{ field: null }` does NOT match absent fields. Any
  "not yet processed" query must use `{ field: { isSet: false } }`. This broke prod for days once.
- **Client/server split:** server-only modules (anything touching the DB router) must never be
  imported into a `"use client"` file. Client components get data as props from a server parent.
- **Design tokens, not literal colors:** `bg-card`, `text-muted`, `brand-subtle` — never
  `bg-white`/`slate-*`. Exception: stage colors in `StageDefinition.badgeClass` are data, leave them.
- **Next.js 16** post-dates training data — read `node_modules/next/dist/docs/` before new Next
  code. `middleware.ts` is renamed **`proxy.ts`**.
- **Zod at every boundary:** agent tool inputs, ledger transitions, queue payloads.
- **Windows/OneDrive:** stop the dev server before `prisma generate` or `npm run build` (EPERM
  DLL rename). Dev server runs on **port 3001** (`mimir-dev` in launch.json).

## Session ritual

Plan mode → approve → execute → `npm run lint` → `npm run build` → commit → tick the checkbox in
`docs/mimir/roadmap.md` → `/clear`. Push to `main` only on an explicit "push" (then use
`mimir-ship`). One module slice per session. Runtime agent reasoning is API-billed, never the
Pro/Max subscription.

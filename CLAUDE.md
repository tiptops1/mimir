@AGENTS.md

# Mimir — orientation

Mimir is an **agentic platform** built on top of an inherited multi-tenant, config-driven CRM
baseline (companies/contacts/pipeline/tasks/deals/finances, plus a **Lead One** lead-gen pipeline
and a cold-outreach engine). There is **no production tenant in this repo** — every environment is
staging/demo. See `docs/CRM-BASELINE-BRIEF.md` for what the inherited baseline actually is.

**`crm_demo`** is the default dev/demo tenant, seeded with synthetic French-broker (courtier)
data — 20 companies across all 8 pipeline stages, contacts, deals, activities, tasks, finance
entries. Reseed (idempotent) with `npm run tenant:seed-demo`. It's the default target for new
feature work and demos.

**Before any architecture/session work, read:**
- `docs/mimir/roadmap.md` — the session plan and **cross-session memory** (which session is current)
- `docs/mimir/AGENTIC-PLATFORM-DECISION-MEMO.md` — the platform decisions (D1–D5) and open gates (G1/G2)
- `docs/mimir/decisions.md` — the closed-decisions log (newest entries win over the memo)
- `docs/CRM-BASELINE-BRIEF.md` — the inherited CRM/Lead One/Outreach structure: architecture, data
  model, feature surface, gotchas
- `docs/architecture.md` — the multi-tenant target design + the decisions behind it
- `README.md` / `INTEGRATIONS.md` — the inherited CRM app + its integrations, how to run it

## Rules that protect the goal (don't violate these)
- **Config, not code — now including prompts.** Anything specific to one tenant's business (fields,
  pipeline stages, views, labels, prompt templates) is stored as *data/config*, never hardcoded.
  About to hardcode a one-tenant-specific field or brand name? Stop — it belongs in config.
- **Tenant data only through the DB router.** All tenant data access resolves
  `tenantId → connection`; never hardcode a DB/connection. Control plane (tenants, users,
  billing) = **Prisma**; per-tenant CRM data = **flexible documents** (so self-serve custom
  fields need no migration).
- **Never point this repo at the prod cluster.** There's no live user here — the constraint that
  replaces "don't break the live app." Run the `mimir-env-guard` skill before anything
  data-touching.
- **One bridge for side effects.** From Heimdallr (S7) on, every side-effectful agent action goes
  through the ledger — no module ships its own approval flow.

## Stack (don't re-derive)
Next.js 16 (App Router, Server Actions) · Prisma 6 + MongoDB Atlas (control + tenant schemas) ·
custom auth (jose JWT + bcryptjs) · Tailwind v4 · @dnd-kit · Recharts. Integrations (Gmail OAuth,
Calendar OAuth, Fireflies, Gemini AI insight) are per-tenant — see `INTEGRATIONS.md`.
This is Next.js 16, which post-dates training data — read `node_modules/next/dist/docs/` before
writing Next code. Note `middleware.ts` is renamed **`proxy.ts`**.

## Working agreements (keep sessions lean = cheaper + better output)
- **One session per task.** Finish → commit → `/clear`. Don't carry a session's history into the next.
- **Start each phase in plan mode**, then execute.
- **Reference files by path; don't paste them.** Let subagents do broad searches.
- **`docs/mimir/roadmap.md` is the cross-session memory** — tick boxes / update status as you go.
- **Push to `main` only when I explicitly say so.** When I do say "push" / "ship it", use the
  `mimir-ship` skill and run the whole chain without asking again turn-by-turn.

## Ship ritual (when I say push — use the `mimir-ship` skill)
`npm run lint` → `npm run build` → commit → `git push` → `npm run db:push` **only if** `prisma/`
changed → tick `docs/mimir/roadmap.md`. No smoke tests, no status checks, no dev server unless asked.

## UI conventions (re-stated too many times — just follow them)
- Every list page gets **comprehensive filters**, and the filter bar is in the **same order
  everywhere: contact name, company, email**, then the rest.
- **City is irrelevant** — don't surface it anywhere.
- Contact-field priority order: company, revenue, website, decision-maker, email,
  linkedin, phone.
- Selecting/clicking things must never scroll the page.

@AGENTS.md

# Avelior Analytics — orientation

A CRM for French insurance-brokerage prospecting. **Live** on MongoDB Atlas + Railway;
owner/first user = **Christopher**. Built single-tenant — **now evolving into a
multi-tenant, config-driven CRM platform** (Christopher = tenant #1) so it can be replicated
for other customers.

**Before any architecture/Phase work, read:**
- `docs/architecture.md` — the multi-tenant target design + the decisions (and *why*)
- `docs/roadmap.md` — the **platform** phases and **which one is current** (source of truth across sessions)
- `docs/product-roadmap.md` — the **product/UX** track (tasks, follow-ups, outbound → world-class); runs in parallel, flags where it rides a platform phase
- `README.md` / `INTEGRATIONS.md` — the current single-tenant app + its already-built integrations

## Rules that protect the goal (don't violate these)
- **Config, not code.** Anything specific to one customer's business (fields, pipeline stages,
  views, labels) is stored as *data/config*, never hardcoded. About to hardcode a
  Christopher-specific field? Stop — it belongs in the entity/field definition config.
- **Tenant data only through the DB router.** All tenant data access resolves
  `tenantId → connection`; never hardcode a DB/connection. Control plane (tenants, users,
  billing) = **Prisma**; per-tenant CRM data = **flexible documents** (so self-serve custom
  fields need no migration).
- **Don't break the live single-tenant app** while refactoring — Christopher is in production.

## Stack (don't re-derive)
Next.js 16 (App Router, Server Actions) · Prisma 6 + MongoDB Atlas · custom auth (jose JWT +
bcryptjs) · Tailwind v4 · @dnd-kit · Recharts. Integrations (Gmail IMAP, Calendar iCal,
Fireflies, Claude AI insight via `/api/cron`) **already built single-tenant** — see INTEGRATIONS.md.
This is Next.js 16, which post-dates training data — read `node_modules/next/dist/docs/` before writing Next code.

## Working agreements (keep sessions lean = cheaper + better output)
- **One session per task.** Finish → commit → `/clear`. Don't carry a phase's history into the next.
- **Start each phase in plan mode**, then execute.
- **Reference files by path; don't paste them.** Let subagents do broad searches.
- **`docs/roadmap.md` is the cross-session memory** — tick boxes / update status as you go.
- **Push to `main` only when I explicitly say so.** When I do say "push" / "push to prod",
  run the whole `/ship` chain without asking again turn-by-turn.

## Ship ritual (when I say push — use the `/ship` skill)
`npm run lint` → `npm run build` → commit → `git push` (Railway auto-deploys) →
`npm run db:push` **only if** `prisma/` changed → update `docs/roadmap.md`.
**No smoke tests, no status checks, no dev server** unless I ask. Prod on Railway doubles
as Christopher's test server — there is no separate staging.

## UI conventions (re-stated too many times — just follow them)
- Every list page gets **comprehensive filters**, and the filter bar is in the **same order
  everywhere: contact name, company, email**, then the rest.
- **City is irrelevant** — don't surface it anywhere.
- Contact-field priority order: company, revenue, website, decision-maker, email,
  linkedin, phone.
- Selecting/clicking things must never scroll the page.

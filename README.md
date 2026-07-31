# CRM baseline

A full-stack CRM for B2B prospecting in the French insurance-brokerage sector (companies
registered under NAF `66.22Z`).

- **Companies** — searchable, filterable directory with full detail/edit pages
- **Contacts** — people (dirigeants) attached to companies
- **Pipeline** — drag-and-drop Kanban board across 8 prospecting stages
- **Analytics** — funnel, conversion, priority/potential/specialty and department breakdowns
- **Dashboard** — KPIs, pipeline distribution and recent activity
- Multi-user accounts with roles (`ADMIN` / `MANAGER` / `USER`) and session auth

## Tech stack

| Layer    | Choice |
|----------|--------|
| Framework| Next.js 16 (App Router, TypeScript, Server Actions) |
| Database | MongoDB (Atlas) via Prisma ORM |
| Auth     | Custom session auth — `jose` (JWT) + `bcryptjs`, cookie-based |
| UI       | Tailwind CSS v4 |
| Drag&drop| `@dnd-kit` |
| Charts   | Recharts |

## Prerequisites

- Node.js ≥ 20
- A MongoDB connection string (Atlas free tier recommended — Prisma needs a **replica set**,
  which Atlas provides by default)

## 1. Local setup

```bash
npm install
cp .env.example .env     # then fill in the values (see below)
```

`.env` values:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Tenant #1's MongoDB URI, e.g. `mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/tenant1?retryWrites=true&w=majority` |
| `CONTROL_DATABASE_URL` | Control-plane MongoDB URI (same cluster, separate DB) |
| `CLUSTER_BASE_URL` | Base connection URI; the DB name is swapped per tenant when provisioning |
| `SESSION_SECRET` | Random 32-byte secret. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ENCRYPTION_KEY` | AES-256-GCM key (32B base64) for encrypted integration credentials — must stay stable |
| `APP_URL` | Public base URL (e.g. `http://localhost:3000`) |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated vendor logins that unlock `/settings/tenants` |

## 2. Push schema + provision a tenant

```bash
npm run db:push:control     # control-plane collections + indexes
npm run db:push             # tenant-schema collections + indexes
npm run tenant:provision    # create an isolated tenant DB + its first ADMIN user
npm run config:seed         # seed default stages + field definitions for that tenant
```

`tenant:provision` is idempotent per tenant slug; re-running it is safe.

## 3. Run

```bash
npm run dev         # http://localhost:3000
```

Log in with the account created by `tenant:provision`.

## Deployment

**See [`docs/chronos/ops.md`](docs/chronos/ops.md)** — the operations runbook. It covers standing up an
environment (Atlas project, Vercel project, fresh secrets), the free-tier constraints that shape
how this is operated, provisioning the first tenant, the full cron schedule, backups and restores,
and what each safety guard will refuse.

Two things worth knowing before you open it:

- **`MIMIR_ENV` declares which environment a process is talking to** (`dev` by default, `prod`
  explicitly). Data-touching scripts read it: production operations require an explicit `--prod`
  flag, and demo seeders refuse to run against production at all.
- **Run `npm run env:check` first.** It reports the resolved environment, whether every required
  variable is present, and the DB hostnames — without printing a single secret.

> The build command (`prisma generate && next build`) and `postinstall` (`prisma generate`) are
> already configured in `package.json`.

## Data enrichment

The CRM imports the source spreadsheet **as-is** — many cells are intentionally empty. The schema
keeps every field, and `POST /api/enrich` is a stub ready to wire up enrichment via the official
French open API (`https://recherche-entreprises.api.gouv.fr`, keyed by SIREN/SIRET) or a custom
pipeline. Personal director contact data is left manual (GDPR).

### Free website discovery

Fills each company's `siteWeb` for free — no API key needed — by searching **Bing** (and, as a
bonus, **DuckDuckGo Lite**) and keeping only a domain whose name strongly matches the company.
It errs on the side of leaving the field blank rather than saving a wrong URL (a wrong website
is worse than none in a CRM).

```bash
npm run enrich:websites              # fill every empty siteWeb
npm run enrich:websites -- --dry     # preview only, write nothing
npm run enrich:websites -- --limit=20
npm run enrich:websites -- --force   # also re-check companies that already have a site
```

> **Run this locally**, from a normal home/office connection. Search engines block datacenter IPs,
> so running it on a server returns nothing. It only ever fills empty `siteWeb` fields — it never
> overwrites a site you've entered.

## Email / calendar sync

Each tenant connects their own Gmail + Google Calendar (OAuth, one-click) from `/chronos/settings`;
every message/meeting is matched to the right counterpart, logged as an activity, and read by the
AI insight pass for a summary, sentiment and next step. Unknown senders queue in the **Boîte de
réception** page. (Fireflies call-transcript sync retired with the generic CRM.)
See `INTEGRATIONS.md` for the full OAuth setup and how matching/dedupe works.

## Project structure

```
prisma/control/schema.prisma  Control plane: Tenant, User, Membership, Integration
prisma/tenant/schema.prisma   Tenant data: Company, Contact, Deal, Activity, Task, … (23 models)
src/app/(app)/                Dashboard, companies, contacts, pipeline, analytics, settings (protected)
src/app/login,register/       Auth screens
src/app/api/                  Cron routes, stage PATCH, enrichment/search endpoints
src/app/actions/              Server Actions (auth, companies, contacts, tasks, …)
src/components/               UI, sidebar, forms, pipeline board, charts
src/lib/                      tenant-db router, session, config, integrations, AI, Lead One
src/proxy.ts                  Route protection (Next.js 16 "proxy" = middleware)
```

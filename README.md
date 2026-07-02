# Avelior Analytics — CRM

A full-stack CRM for B2B prospecting in the French insurance-brokerage sector, built from the
"CRM Chris 0-200" dataset (companies registered under NAF `66.22Z`).

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
| `DATABASE_URL` | MongoDB URI, e.g. `mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/avelior?retryWrites=true&w=majority` |
| `SESSION_SECRET` | Random 32-byte secret. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `APP_URL` | Public base URL (e.g. `http://localhost:3000`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` | Default admin account created by the seed |

## 2. Push schema + seed data

```bash
npm run db:push     # creates collections + indexes in MongoDB
npm run seed        # imports data/crm-chris-0-200.csv (~198 companies) + admin user
```

The seed is **idempotent** (upserts by SIRET / email) and seeds **Christopher** as the `ADMIN`
account owner.

## 3. Run

```bash
npm run dev         # http://localhost:3000
```

Log in with the `SEED_ADMIN_*` credentials, or register a new (`USER`) account at `/register`.

## Deployment — GitHub → Railway

1. **Push to GitHub**
   ```bash
   git remote add origin https://github.com/<you>/avelior-analytics.git
   git push -u origin main
   ```
2. **Create the Railway project** → "Deploy from GitHub repo" → pick this repo.
   Railway auto-detects Next.js (Nixpacks); `railway.json` sets the start command.
3. **Set environment variables** in the Railway service → *Variables*:
   - `DATABASE_URL` — your MongoDB Atlas URI
   - `SESSION_SECRET` — a fresh random secret
   - `APP_URL` — the Railway public URL (e.g. `https://avelior-analytics.up.railway.app`)
   - `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`
4. **Allow Atlas network access** from anywhere (`0.0.0.0/0`) so Railway can connect.
5. **First deploy** builds and starts automatically. Then run the one-off setup once:
   ```bash
   railway run npm run db:push
   railway run npm run seed
   ```
   (or use the Railway dashboard's one-off command runner).

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

> **Run this locally**, from a normal home/office connection. The search engines block datacenter
> IPs, so running it on a server (or Railway) returns nothing. It only ever fills empty `siteWeb`
> fields — it never overwrites a site you've entered.

## Email sync (Gmail / Google Workspace)

Logs Christopher's sent & received emails against the right contact, and queues unknown senders
for review in the **Boîte de réception** page.

**One-time setup (Google account for `Ctoppo@avelior.eu`):**
1. Enable **2-Step Verification**.
2. Create an **App Password** (type: Mail) — a 16-character code.
3. Gmail → Settings → *Forwarding and POP/IMAP* → **enable IMAP**.
4. Workspace admin console → ensure **IMAP** and **App Passwords** are allowed for the org.
5. Set env vars (locally in `.env`, and in Railway):
   ```
   IMAP_HOST=imap.gmail.com
   IMAP_PORT=993
   IMAP_USER=Ctoppo@avelior.eu
   IMAP_PASSWORD=<the App Password>
   OWNER_EMAIL=Ctoppo@avelior.eu
   ```

**Run it:**
```bash
npm run sync:email              # incremental — only mail since the last run
npm run sync:email -- --backfill=200   # also import the last 200 messages per folder
npm run sync:email -- --dry     # connect + parse, write nothing
```
First run is **going-forward only** (it records the current mailbox position and imports nothing)
unless you pass `--backfill`. Schedule it on Railway as a **cron service** every ~5 minutes.

**Matching policy:** email matches an existing contact → logged as an activity. No contact but the
domain matches a known company → a contact is auto-created under it. Otherwise the sender lands in
the review queue, where you approve (attach to a company / create a new one) or ignore.

## Project structure

```
prisma/schema.prisma     Models: User, Company, Contact, Activity (+ enums)
prisma/seed.ts           CSV import + admin seed
data/                    Source CSV
src/app/(app)/           Dashboard, companies, contacts, pipeline, analytics (protected)
src/app/login,register/  Auth screens
src/app/api/             Stage PATCH + enrichment stub
src/app/actions/         Server Actions (auth, companies, contacts)
src/components/          UI, sidebar, forms, pipeline board, charts
src/lib/                 db, session, dal, validations, constants
src/proxy.ts             Route protection (Next.js 16 "proxy" = middleware)
```

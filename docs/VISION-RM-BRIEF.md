# Vision RM — consolidated brief

> **Purpose.** Single source of truth for Claude Projects: product, architecture, plan, and the
> hard-won gotchas. Everything here is **current state + the reasoning behind it**. Chronological
> history lives in `docs/roadmap.md` / `docs/product-roadmap.md` working logs — deliberately not
> repeated here.
>
> **Verified against the repo on 2026-07-15** at commit `6f8af65`. When this doc and a working log
> disagree, this doc is newer. When this doc and the **code** disagree, the code wins — say so.

---

## 1. Identity — don't re-derive this

| | |
|---|---|
| **Product** | **Vision RM** — a multi-tenant, config-driven CRM for French insurance-brokerage prospecting |
| **Repo** | `avelior-analytics` (legacy name, github.com/tiptops1/avelior-analytics) |
| **Vendor** | Nicolas — independent builder, owns the platform. Personal Gmail only. |
| **Customer #1** | **Avelior** (Christopher, `Ctoppo@avelior.eu`), tenant slug `crm_chris` |
| **Language** | The UI is **French**. Copy, labels, enum labels, emails — all French. |
| **Market** | French insurance brokers, NAF code `66.22Z` |

Christopher is **in production right now**. He is a real user with real data (~731 companies, ~839
contacts). "Don't break the live app" is a hard constraint on every change.

The vendor has **no Google Workspace, no avelior.eu access, and no client-side credentials**. Never
assume otherwise. Anything requiring Workspace admin or the avelior.eu domain is **Christopher's to
do** and must be handed to him as instructions, not attempted.

---

## 2. State at a glance

| Track | Status |
|---|---|
| Platform Phase 0 — multi-tenant spine | ✅ deployed |
| Platform Phase 1 — config-driven core | ✅ deployed |
| Platform Phase 2 — self-serve customization | ✅ deployed |
| Platform Phase 3 — per-tenant integrations | ✅ deployed |
| Platform Phase 4 — productize & replicate | ⚠️ code done (provisioning); branding/billing/customer #2 are business decisions |
| Product P0 — system of action (tasks) | ✅ deployed |
| Product P1 — outbound, deals, sequences, notifications | ✅ deployed |
| Product P2 — scale & polish | ✅ deployed |
| Product P3 — Finances cockpit | ✅ deployed |
| Product P5 — cold outreach engine | ⚠️ **deployed but dormant** — no OUTREACH credential = nothing sends |
| Lead One — lead-gen pipeline | ✅ deployed; needs API keys set to run at full strength |

Everything code-shaped on the platform track is **done**. The remaining platform work is sales and
business decisions, not engineering.

---

## 3. Architecture — three planes

```
CONTROL PLANE · shared DB `crm_control` (Prisma, typed)
  Tenant │ User │ Membership │ Integration (encrypted creds)
        │
        ▼  router: tenantId → connection string (AES-256-GCM decrypt)
TENANT DATA PLANE · one isolated MongoDB DB per customer, shared Atlas cluster
  crm_chris ──┐  crm_acme   crm_…   (provisioned on signup)
   • FieldDefinition + StageDefinition  ← config that drives forms/tables/board
   • Company · Contact · Deal · Activity · Task · …
        ▲
        │  writes into each tenant's timeline
INTEGRATION LAYER · per-tenant OAuth
  Gmail │ Google Calendar │ Fireflies → ingestion → Gemini AI insight
```

### Decision 1 — DB-per-tenant on a **shared** Atlas cluster

Each customer gets a logically separate database (`crm_chris`, `crm_acme`) on **one** cluster. Real
data isolation and per-customer backup/export, without paying for or operating N clusters.
Onboarding = create a DB + seed config.

*Rejected:* cluster-per-tenant (≈$60+/mo/customer, slow onboarding — reserve for a client whose
compliance demands physical isolation); repo-per-tenant/forking (N codebases, defeats the goal).

Because the router is an abstraction, a large client can later be promoted to their **own cluster**
with zero app-code change.

### Decision 2 — Config-driven schema, not per-customer code

A tenant's custom fields, pipeline stages and views live in **entity/field-definition config
stored as data**; the UI renders dynamically from it. New customer = new config, zero code changes.

Prisma fights this (it wants a fixed typed schema), hence the split:
- **Control plane → Prisma.** Stable schema, keep the type safety.
- **Tenant CRM data → flexible Mongo documents.** Custom fields are just keys on a document, so a
  tenant adding a field needs **no migration**. This is *why* MongoDB is the right fit here.

### Decision 3 — Integrations were built single-tenant, then made per-tenant

Credentials live encrypted in the control plane (`Integration`), and ingestion routes to the right
tenant DB via `lib/tenant-cron.ts`. Legacy env fallbacks (IMAP/ICS/`FIREFLIES_API_KEY`) are **gated
to tenant #1 only**, so another tenant can never ingest Christopher's mailbox.

AI keys (Gemini/Claude) stay **env-based by design** — they're the platform's own provider account,
not a tenant credential.

---

## 4. The rules that protect the goal

These are non-negotiable. Violating them is the rebuild we're avoiding.

1. **Config, not code.** Anything specific to one customer's business (fields, stages, views,
   labels) is stored as *data/config*. About to hardcode a Christopher-specific field? Stop — it
   belongs in the field-definition config.
2. **Tenant data only through the DB router.** All tenant access resolves `tenantId → connection`
   via `await getTenantDb()`. Never hardcode a DB or connection string.
3. **Don't break the live single-tenant app.** Christopher is in production. Prefer additive schema
   changes.
4. **Push to `main` only on an explicit "push".** When the user does say it, run the whole `/ship`
   chain without asking turn-by-turn.
5. **This is Next.js 16** — it post-dates model training data. Read `node_modules/next/dist/docs/`
   before writing Next code. Note `middleware.ts` is renamed **`proxy.ts`**.

---

## 5. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 — App Router, TypeScript, Server Actions |
| DB | MongoDB Atlas via Prisma 6 (two schemas: control + tenant) |
| Auth | Hand-rolled — `jose` JWT + `bcryptjs`, cookie sessions. **Not NextAuth** (deliberate: reliability on bleeding-edge Next) |
| UI | Tailwind v4 + a semantic CSS-variable design system (light **and** dark) |
| Drag & drop | `@dnd-kit` |
| Charts | Recharts |
| Validation | `zod` |
| Google | `googleapis` |
| Email parsing | `imapflow` + `mailparser` (legacy IMAP path) |
| Host | **Vercel** (migrated off Railway 2026-07-14) |
| AI | Google **Gemini 2.5 Flash** (primary), Claude Haiku (fallback) — raw fetch, no SDK |

**Prisma 6, not 7** — Prisma 7's `prisma-client` generator is SQL-driver-adapter only and doesn't
cleanly support MongoDB. Prisma 6 uses the binary engine + `new PrismaClient()` reading
`DATABASE_URL`. Don't "upgrade" this.

---

## 6. Data model

**Control plane** (`prisma/control/schema.prisma` → generated to `src/generated/control`):
`Tenant`, `User`, `Membership`, `Integration`.

`Integration` carries `provider` (google | fireflies) × `purpose` (**MAIN | OUTREACH**), with the
secret AES-256-GCM encrypted in the `refreshToken` slot.

**Tenant data** (`prisma/tenant/schema.prisma` → default `@prisma/client`) — 23 models:

| Group | Models |
|---|---|
| Core CRM | `Company`, `Contact`, `Deal`, `Activity` |
| Action layer | `Task`, `Sequence`, `Enrollment` |
| Config | `FieldDefinition`, `StageDefinition`, `Setting`, `SavedView` |
| Ingestion | `PendingContact`, `BlockedSender`, `EmailSyncState`, `SyncCursor` |
| Outreach | `OutreachMessage`, `OutreachConfig` |
| Lead gen | `LeadCandidate`, `LeadOneQuota`, `LeadOneRun` |
| Finance | `FinanceEntry` |
| Compliance / analytics | `AuditLog`, `StageChange` |

`User`/`Role` were **removed** from the tenant schema — `Activity.userId` is a loose control-plane
id, resolved via `lib/authors.ts`.

`Company.stage` is a **String**, not a Prisma enum (stages are config now). Mongo always stored it
as a string, so that change needed no data migration.

---

## 7. Feature surface

| Route | What it is |
|---|---|
| `/dashboard` | Work surface: "À faire aujourd'hui" + "Prospects à relancer" lead; KPIs/pipeline/activity below |
| `/companies` | **"Suivi"** — engaged prospects only (`?all=1` lifts the gate). Filters, bulk actions, saved views, CSV export |
| `/companies/[id]` | The fiche — inline-editable, timeline, tasks, deals, sequences, AI email composer |
| `/contacts` | People (dirigeants), + `/contacts/new` |
| `/pipeline` | Drag-drop Kanban, columns from `StageDefinition` |
| `/todo` | Task buckets: En retard / Aujourd'hui / À venir / À planifier |
| `/inbox` | "Boîte de réception" — `PendingContact` review queue (approve/dismiss/spam/→task) |
| `/analytics` | Funnel (clickable → pipeline) + "Dynamique du pipeline" (StageChange-driven) |
| `/finances` | Business cockpit — KPI strip, échéances radar, cost donut, inline-editable table |
| `/leadone` | Lead One review queue → promote to Company/Contact |
| `/outreach` | Cold-outreach dashboard + `/outreach/sequences` editor |
| `/settings/*` | ADMIN: `fields`, `stages`, `integrations`, `duplicates`, `audit`. Vendor-only: `tenants` |

**North star:** *the CRM tells the user what to do each morning, lets them do it in one click, and
the AI keeps the record updated on its own.* Every screen must answer "who do I contact next, and
when?" — a view that only looks backward is a report, not a workspace.

---

## 8. Subsystems

### 8.1 Ingestion + AI (the moat)

Google OAuth (Gmail + Calendar) → activities; Fireflies transcripts → activities; then **Gemini**
writes summary / sentiment / next-step / action-items / suggested-stage per activity, and auto-seeds
`Task`s from `nextStep` (deduped by `activityId`).

Quality gate at ingestion so spam never enters: `mime-email.ts detectBulk` (List-Unsubscribe,
List-Id, Precedence, Auto-Submitted, Feedback-ID) + `email-sync.ts` sender heuristics
(`isAutomatedSender`, `looksLikePerson` prenom.nom guard, `ROLE_TOKENS` denylist). Unknown senders
land in the `/inbox` queue; PENDING entries **auto-expire after 14 days** so it stays triage, not a
backlog. "Spam" permanently blocks address **and** domain via `BlockedSender`.

`suggestedStage` prompt rule: the last stage actually **franchie**, never a planned one (it used to
over-advance planned demos to DEMO_REALISEE).

### 8.2 Outreach (P5 — dormant)

A **separate OUTREACH Google identity** (`Integration.purpose = OUTREACH`) sends multi-touch cold
sequences to Lead One prospects. `src/lib/outreach/`: French business-day math, spread budget,
threading ("Re:" follow-ups, subject on first mail only), ledger + timeline Activity, reply/bounce
sync (threadId match → REPLIED exit + "Répondre" task), a 7-day bounce-rate **breaker** that pauses
sending, and public HMAC opt-out → BlockedSender + consent OPT_OUT + AuditLog.

**Decided 2026-07-14 (Option A):** send from a dedicated `prospection@avelior.eu` mailbox on
Christopher's existing Workspace. A dedicated mailbox keeps replies/bounces out of his personal
inbox (the reply sync scans it). **No new domain** — the avelior.eu Workspace provides the
**Internal** OAuth client, which is the only reason a domain purchase was ever considered.

*Deferred (Option B):* a separate throwaway sending domain for deliverability isolation. Skipped for
v1 — low volume + personalised mail makes shared-domain risk minor. Revisit as volume climbs.

### 8.3 Lead One

Free-tier lead-gen feeding the CRM. `src/lib/leadone/`, `scripts/leadone/`, review at `/leadone`,
`npm run leadone:run`, GitHub Actions daily 08:15 UTC.

1. **Source** — `recherche-entreprises.api.gouv.fr`, NAF 66.22Z, per-département cursor in
   `Setting`. Dedupes by **SIREN** (multi-agency networks like GAN/MMA would waste quota).
2. **Website** — Tavily (1,000/mo free) → Exa.ai (1,000/mo) overflow. Ledger in `LeadOneQuota`.
3. **Crawl + validate** — own crawler reads mentions légales, verifies ownership via SIREN/name on
   page; MX validation. Validates as soon as **any** of website/phone/email is found.
4. **LinkedIn** — SerpApi (250/mo), VALIDATED candidates only, **its own quota** so it never
   competes with website discovery. Each dirigeant looked up at most once ever
   (`dirigeants[].linkedinChecked`). Blue ✓ = verified real profile; grey = unverified search
   redirect.
5. **Promote** — SIRET + domain + name dedupe, BlockedSender check.

**Provider history — do not re-research:** Google CSE was primary until its web-search API died
(removed 2026-07-13). Brave was never integrated — its free tier died Feb 2026. Tavily replaced CSE.
Paid upgrade path if volume demands: Serper.dev (~$1/1k real Google results, `gl=fr`).

### 8.4 Finances

One flexible `FinanceEntry` (`direction` OUT/IN × `kind` SUBSCRIPTION/STAFF/EXPENSE/INVOICE; euros,
recurrence, status, trial/renew/due dates, optional company link, `customFields`) + a `Setting`
key/value store for trésorerie. `advanceFinanceAlerts` materializes trial-ends/renewals/invoices-due
into `FINANCE` Tasks (deduped by `financeEntryId`) → `/todo` + bell + digest for free.
`Task.companyId` is optional so finance tasks need no company.

---

## 9. Deployment & ops

**GitHub → Vercel**, auto-deploy from `main`. Prod doubles as Christopher's test server — there is
**no staging**.

### The cron split (important)

Vercel Hobby caps functions at **60s**, so the monolithic `/api/cron` was split. All four routes
accept `Authorization: Bearer $CRON_SECRET` **or** `?key=$CRON_SECRET`, and are scheduled
externally on **cron-job.org** (deliberately off-host to save credit):

| Route | Does | Schedule |
|---|---|---|
| `/api/cron` | Gmail/Calendar/Fireflies sync | every 4h |
| `/api/cron/enrich` | Gemini AI enrichment | hourly |
| `/api/cron/advance` | sequences + finance alerts + digest | every 4h |
| `/api/cron/outreach` | cold-email send engine | hourly, Mon–Fri 08:00–18:00 Europe/Paris |

Response shape is `{ ranAt, tenants: [...] }`. Manual run = open the URL with `?key=`.

⚠️ **Open question:** whether all four are actually configured on cron-job.org post-migration is
**unverified**. If only the original `/api/cron` is scheduled, AI enrichment and sequence
advancement are silently not running — the same failure class as the `isSet` bug (§11).

### Ship ritual (the `/ship` skill)

`npm run lint` → `npm run build` → commit → `git push` → `npm run db:push` **only if `prisma/`
changed** → update the roadmap. No smoke tests, no status checks, no dev server unless asked.

### Atlas

Cluster `crm-railway.grgeizg.mongodb.net` (name is legacy). Network Access must be `0.0.0.0/0`
Active or Prisma fails with a TLS "received fatal alert: InternalError". Prisma requires a **replica
set** — Atlas provides one by default.

**Atlas Search** powers the global top-bar search (`$search` via Prisma `aggregateRaw`,
`lib/search.ts`, `/api/search`); dynamic-mapping "default" indexes created by `npm run
search:indexes`. Free on all tiers (M0 ≤3 indexes).

**Two-tier search model:** the top bar = "jump to a known record" (Atlas, fuzzy, navigates away).
Per-page boxes = "narrow the list I'm working" (regex `contains`, composes with structured filters +
pagination — deliberately **not** Atlas).

### Google OAuth

The Cloud project ("Vision RM", `320715852987`) lives in the **vendor's personal Google account** —
it's the platform app every customer connects to, so it must be named neutrally, never "avelior".
With no Workspace org, the consent screen is **External → Testing**, so refresh tokens **expire ~7
days** → reconnect weekly via "Connecter Google". Permanent fix = publish to Production + Google
CASA verification (gmail is a restricted scope). The OUTREACH client sidesteps this entirely by
being **Internal** to the avelior.eu org.

### Cost

Gemini 2.5 Flash on the **paid** tier (billing enabled): ~365 in / 162 out tokens per interaction ⇒
**~€0.15–0.25/month**. €10 prepay + €2 budget alert. The GCP budget "cap" only **alerts** — the €10
prepay is the real hard stop. Model is `gemini-2.5-flash` (**Flash, not Pro** — a deliberate cost
choice). `reasoning_effort: "none"` kills 2.5-flash thinking tokens (~4× less billable output, no
quality loss). Single 429 retry for free-tier RPM bumps.

---

## 10. Environment variables

Secrets live in `avelior-analytics/.env` only. **Never echo them, never put them in settings or
allowlists, never ask for them in chat** — reference by name.

| Var | Notes |
|---|---|
| `DATABASE_URL` | Tenant #1's data DB |
| `CONTROL_DATABASE_URL` | `crm_control`, same cluster |
| `CLUSTER_BASE_URL` | Base URI; DB-name path swapped for the slug when provisioning |
| `ENCRYPTION_KEY` | AES-256-GCM, 32B base64. **Must stay stable** — rotating orphans every stored connection string + refresh token |
| `SESSION_SECRET` | Signs session JWTs |
| `TENANT1_SLUG` | `crm_chris` — how session-less contexts resolve tenant #1 |
| `PLATFORM_ADMIN_EMAILS` | Vendor logins, comma-separated. Unlocks `/settings/tenants`. Tenant ADMINs (Christopher) must **not** be listed |
| `APP_URL` | Public base URL — used for links in the digest |
| `CRON_SECRET` | Bearer/`?key=` for all four cron routes |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Wins if set |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Fallback; no key at all = AI no-op |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_OAUTH_REDIRECT_URI` | MAIN identity |
| `GOOGLE_OUTREACH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | OUTREACH identity — **unset, the P5 blocker** |
| `TAVILY_API_KEY`, `EXA_API_KEY`, `SERPAPI_KEY` | Lead One |
| `IMAP_*`, `OWNER_EMAIL`, `GOOGLE_CALENDAR_ICS_URL`, `FIREFLIES_API_KEY` | Legacy fallbacks, **tenant #1 only** |

Local `.env` points at **prod** Atlas, so `npm run` scripts act on **live data**. Treat every script
run as production.

---

## 11. Gotchas — the expensive lessons

**Mongo `null` ≠ missing.** A Prisma `{ field: null }` filter does **not** match a document where
the field is *absent*. This silently killed AI enrichment in prod for days: `enrichActivities`
filtered `aiSummary: null`, activity docs are created without that field, so it matched 0 rows
forever while Gemini looked live. Fix: `{ aiSummary: { isSet: false } }`. Same trap fixed in the
three `dernierContact` `updateMany`s. **Any new "not yet processed" query must use `isSet: false`.**

**Atlas `$search` on a missing index returns `[]`, not an error.** So `searchAll` falls back to
regex on *empty* results, not just on error — a broken index looks like "no matches".

**Search engines block datacenter IPs.** `enrich:websites` and `LEADONE_KEYLESS=1` keyless Bing/DDG
scraping work **only from a residential IP** — they must run locally, never on CI or the host.

**Windows/OneDrive:** stop the dev server before `prisma generate` / `npm run build` — a running
node process holds the Prisma query-engine DLL → EPERM rename failures. PowerShell 5.1 console is
cp1252; don't print accented text from scripts. No system Python — use `uv`. Run one-off TS via
`npx tsx` **from inside `avelior-analytics/`**.

**Paths:** run all npm/prisma/git/tsx commands from `avelior-analytics/`, never the workspace root.
Scratch scripts go in `avelior-analytics/scripts/` — Temp scripts can't resolve `node_modules` or
`dotenv/config`.

**Client/server split:** `lib/stage-config.ts` is server-only (pulls the tenant DB router);
`lib/stage-meta.ts` is the client-safe half. Client components take `stages`/`stageDefs` as **props
from a server parent** — importing the server module into a `"use client"` file is a build error.

**React state does not persist across separate preview eval calls.** Test interactive flows in ONE
self-contained expression.

**Claude Pro ≠ API.** Pro can't run the unattended cron. The way to leverage Pro is a CRM **MCP
connector** so Christopher chats with his whole CRM at zero marginal cost.

---

## 12. Commands

```bash
npm run dev                  # localhost:3000
npm run build                # prisma generate (both schemas) + next build
npm run lint

npm run db:push              # tenant schema → Atlas
npm run db:push:control      # control schema → Atlas
npm run prisma:generate      # both clients

npm run tenant:bootstrap     # promote Chris in place as tenant #1
npm run tenant:provision     # new isolated tenant DB + admin
npm run user:add             # idempotent control-plane login + membership
npm run config:seed          # seed stages + field definitions
npm run search:indexes       # create Atlas Search indexes

npm run sync:all             # email + calendar + fireflies + AI (local)
npm run clean:inbox          # retroactively dismiss queued spam (--dry)
npm run enrich:websites      # LOCAL ONLY — residential IP required

npm run leadone:run          # full lead-gen pipeline
```

---

## 13. Open items

**Blocking P5 go-live** (Christopher's, not code):
1. Create `prospection@avelior.eu` mailbox on the avelior.eu Workspace.
2. Create an **Internal** OAuth client in the avelior.eu GCP org → hand over id/secret/redirect URI.
3. Set `GOOGLE_OUTREACH_*` on **Vercel**.
4. Confirm the hourly `/api/cron/outreach` schedule.

**Verify:**
- All four cron routes actually scheduled on cron-job.org post-Vercel (§9).
- The prod Vercel URL — **not recorded anywhere**; the old Railway URL is dead and README has only a
  placeholder. Worth writing down.

**Known doc drift:** `docs/roadmap.md`, `docs/product-roadmap.md` and parts of `README.md` still say
"Railway → auto-deploy". Only `CLAUDE.md` + the README deploy section were updated in `6f8af65`.

**Deferred, needs a decision:** per-tenant branding/subdomain (DNS); billing provider (Stripe
recommended); customer #2 (sales). Per-rep leaderboard waits on >1 active rep. Email templates were
superseded by the AI composer. Lead One paid upgrade = Serper.dev if volume demands.

**Lint baseline (verified 2026-07-15):** `npm run lint` = **0 errors, 3 warnings** — unused `Input`
in `company-detail-actions.tsx`, unused `dateValue` in `company-form.tsx`, and an `exhaustive-deps`
warning on `pipeline-board.tsx:231`. Anything beyond these three is yours. *(Both roadmaps still
list a stale "known pre-existing lint errors" set — enum-cell / global-search `set-state-in-effect`
and `no-explicit-any` in `enrich-dirigeants.ts`. All fixed; ignore those notes.)*

---

## 14. Conventions

**UI** (restated too many times — just follow them):
- Every list page gets **comprehensive combinable filters**, in the **same order everywhere**:
  contact name, société, email, then the rest. URL-driven + debounced via `useUrlFilters` — no
  "Filtrer" button.
- **City is irrelevant** — never surface it.
- Contact-field priority order: company, revenue, website, decision-maker, email, linkedin, phone.
- Selecting/clicking must **never scroll the page**.
- Design system is token-based (`globals.css` semantic CSS variables). Use tokens — `bg-card`,
  `text-muted`, `brand-subtle` — never literal `bg-white` / `slate-*` / `indigo-*`. Exception: stage
  colors stored as **data** in `StageDefinition.badgeClass` are literal hue utilities and are
  remapped by a dark-mode compat layer.

**Working:**
- One session per task. Finish → commit → `/clear`.
- Start each phase in plan mode, then execute.
- Reference files by path; don't paste them. Let subagents do broad searches.
- The roadmaps are the cross-session memory — tick boxes as you go.
</content>
</invoke>

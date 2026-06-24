# Roadmap — single-tenant → multi-tenant platform

> **Cross-session source of truth.** Update the status + checkboxes here as work lands, so any
> freshly-`/clear`ed session knows exactly where things stand. See `docs/architecture.md` for the why.

**Current phase: Phase 0 — DONE (verified live), pending commit + Railway env + deploy.**
The single-tenant app is live and working (companies, contacts, pipeline, analytics, auth, and
Gmail/Calendar/Fireflies/Claude integrations). The spine is built, statically verified (tsc + next
build green), bootstrapped against the live Atlas cluster, and two-tenant isolation was confirmed in
the browser. Next session = Phase 1.

---

## Phase 0 — Spine (multi-tenancy foundation) ⬅️ current
Get tenancy right *before* features — retrofitting it later is the rebuild we're avoiding.
- [x] Control-plane schema (Prisma): `Tenant`, `User`, `Membership` (`prisma/control/schema.prisma`,
      generated to `src/generated/control`). Tenant data is its own schema/client
      (`prisma/tenant/schema.prisma` → default `@prisma/client`); `User`/`Role` removed from it,
      `Activity.userId` loosened to a control-plane id.
- [x] `tenantId → connection string` DB router (`src/lib/tenant-db.ts` per-connection cache +
      `src/lib/tenant-context.ts` `getTenantDb()`, request-memoized; decrypts the stored conn string).
- [x] Tenant provisioning script: `scripts/provision-tenant.ts` (`npm run tenant:provision`) —
      derive conn string from `CLUSTER_BASE_URL`, `db push`, register tenant + admin. (Stored config
      seeding lands in Phase 1 — the config store doesn't exist yet.)
- [x] Tenant context in auth/session (`session.ts` `tenantId`+role; `auth.ts` login via control
      plane → membership). `proxy.ts` gate unchanged (real resolution in the DAL, by design).
- [x] Migrate Christopher's data into tenant #1 — **promoted in place** via
      `npm run tenant:bootstrap` (ran live): control DB `crm_control` created, tenant #1 `crm_chris`
      registered pointing at the existing `CRM-Railway` DB (untouched), both existing users copied to
      the control plane as ADMIN members. Zero tenant-data movement.
- [x] Verify: two tenants, fully isolated data, in browser — **confirmed.** Tenant #1 login showed
      731 sociétés / 839 contacts (Chris's real data); demo-tenant login showed 0/0, fully isolated.
      Stale pre-multi-tenant sessions (JWT without `tenantId`) are now rejected by `proxy.ts` +
      `verifySession` → clean re-login (no crash, no redirect loop) — matters on deploy day.

**Cron/scripts caveat (intentional, not a regression):** session-less ingestion (`/api/cron`,
`sync:*`) stays single-tenant on tenant #1 via `getTenant1Prisma()` (`DATABASE_URL`). Per-tenant
ingestion routing is Phase 3.

**New env vars (see `.env.example`):** `CONTROL_DATABASE_URL`, `CLUSTER_BASE_URL`, `ENCRYPTION_KEY`
(AES-256-GCM, must stay stable — rotating it orphans stored connection strings).

**Known pre-existing lint errors (NOT Phase 0):** `react-hooks/set-state-in-effect` in
`components/enum-cell.tsx` + `components/global-search.tsx`, and `no-explicit-any` in
`scripts/enrich-dirigeants.ts`. `next build` does not fail on them.

## Phase 1 — Config-driven core
The product itself; Chris's CRM becomes one *config* of it.
- [ ] Entity & field-definition model (config stored as data)
- [ ] Dynamic form + table rendering from config
  - ~ *Partial:* pipeline card render seam exists (`src/lib/tenant-config.ts` →
    `getTenantConfig().pipelineCard`); still a hardcoded constant, not yet a stored config model.
- [ ] Express Chris's current Company/Contact/Deal fields + 8 pipeline stages as seeded config
- [ ] Custom-field read/write on flexible documents (no migration to add a field)

## Phase 2 — Self-serve customization
Proves the "fully editable" promise on a real user before selling it.
- [ ] UI for a tenant to add/edit their own fields
- [ ] UI for pipeline stages + saved views
- [ ] Guardrails/validation so self-serve edits can't corrupt data

## Phase 3 — Integrations per-tenant
The moat already exists single-tenant — make it multi-tenant.
- [~] Move integration credentials to per-tenant, encrypted in control plane — **DONE for Google,
      single-tenant.** New control-plane `Integration` model (refresh token AES-256-GCM encrypted via
      `crypto.ts`); helpers in `src/lib/integrations.ts`. Fireflies/Claude creds still env-based.
- [ ] Route `/api/cron` ingestion (Gmail/Calendar/Fireflies + Claude insight) to the right tenant DB —
      cron still `getTenant1Prisma()`; it now resolves tenant #1's Google credential (by `TENANT1_SLUG`)
      but does **not** iterate tenants yet. The real per-tenant loop is still open.
- [~] Per-tenant connect/disconnect UI for each source — **DONE for Google, tenant #1.** Seamless OAuth
      connect/disconnect on the dashboard. Fireflies/Calendar-ICS still env-only.

**Pulled-ahead slice (2026-06-24):** seamless Google (Gmail + Calendar) OAuth — see working log. Replaces
the manual IMAP App-Password + secret-iCal setup for tenant #1; legacy env paths remain as fallback.

## Phase 4 — Productize & replicate
Replication = "Phase 0 on demand."
- [ ] Self-serve onboarding flow (create tenant → provision DB → seed config)
- [ ] Per-tenant branding + subdomain
- [ ] Billing
- [ ] Onboard customer #2

---

## Working log (newest first)
- 2026-06-24 — **Seamless Google (Gmail + Calendar) OAuth — single-tenant swap (code complete, not yet
  deployed/connected).** Pulled-ahead slice of Phase 3 at owner's request (single-tenant first; read+write
  scopes requested but only read ingestion built). Replaces manual IMAP App-Password + secret-iCal with a
  one-click **Connecter Google** flow. **Control plane:** new `Integration` model (provider/accountEmail/
  encrypted refreshToken/scopes/status/lastSyncedAt, `@@unique([tenantId, provider])`); helpers in
  `src/lib/integrations.ts` (encrypt via `crypto.ts`). **Tenant DB:** new `SyncCursor` model (Gmail
  historyId-style epoch cursor + Calendar syncToken). **OAuth:** `src/lib/google-oauth.ts` (authUrl/
  exchangeCode/authedClientForTenant/resolveTenant1Google/revoke; `GoogleOAuthClient` type derived from
  googleapis to dodge the dual google-auth-library copies); routes `api/integrations/google/connect` +
  `/callback` (CSRF state cookie); disconnect server action `dashboard/integration-actions.ts`.
  **Ingestion swap (read):** `gmail-sync.ts` (Gmail API `messages.list`/`get` raw → shared `mime-email.ts`
  `parseRawEmail` → existing `processEmail`) and `google-calendar-sync.ts` (events.list → mapped to
  `IcsEvent` → refactored `processCalendar(events[])`, dedup key stays `cal:<iCalUID>`). `imap-sync.ts`
  reuses `mime-email`. **Cron + scripts** prefer the OAuth credential, else legacy IMAP/ICS (no breakage).
  **UI:** `connect-gmail-cta.tsx` rewritten (connect link / connected+disconnect); dashboard reads
  `getGoogleConnection` + `?google=` banner; dropped `tenant-config` `googleAccountEmail`. **Dep:**
  `googleapis`. **New env:** `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `TENANT1_SLUG`.
  `tsc` + `next build` green (only the known pre-existing enum-cell/global-search lint errors remain).
  **NOT yet done (owner-only / runtime):** Google Cloud project + OAuth client + the `GOOGLE_*` env vars;
  `db:push:control` + `db:push` for the two new models; the live connect→sync→disconnect verification.
- 2026-06-23 — **Phase 0 spine — code complete (not yet deployed/bootstrapped).** Built the
  multi-tenancy foundation. **Two Prisma schemas:** control plane (`prisma/control/schema.prisma` →
  `Tenant`/`User`/`Membership`, generated to `src/generated/control`, `CONTROL_DATABASE_URL`) +
  tenant data (`prisma/tenant/schema.prisma`, default `@prisma/client`; dropped `User`/`Role`,
  `Activity.userId` is now a loose control-plane id). `package.json` `prisma:generate` builds both;
  `db:push`/`db:push:control` split. **DB router:** `tenant-db.ts` (per-conn cached `PrismaClient`
  + `getTenant1Prisma()` for session-less cron/scripts) + `tenant-context.ts` `getTenantDb()`
  (request-memoized; session.tenantId → control `Tenant` → `decrypt(connectionString)` → client).
  `crypto.ts` = AES-256-GCM. **Auth:** `session.ts` carries `tenantId`+membership role; `auth.ts`
  login authenticates against the control plane and resolves the active tenant via `Membership`;
  `register` disabled until Phase 4. **All ~17 tenant-data call sites** swapped from the retired
  `@/lib/db` singleton to `await getTenantDb()` (pages/actions/`api` routes); `search.ts` threads the
  client; activity-author names now resolve from the control plane (`lib/authors.ts`). **Scripts:**
  `tenant:bootstrap` (promote Chris in place as tenant #1, no data movement) + `tenant:provision`
  (new isolated DB + admin). Decisions locked with owner: **promote-in-place, two schemas, keep a
  demo tenant.** `tsc` + `next build` green; new code lint-clean. **Ran live:** `db:push:control` +
  `tenant:bootstrap` (Chris promoted in place) + `tenant:provision demo`; browser-verified isolation
  (tenant #1 = 731/839, demo = 0/0). Hardened `proxy.ts` + `verifySession` to reject pre-multi-tenant
  JWTs (no `tenantId`) so existing logged-in users re-login cleanly instead of crashing on deploy.
  **Local `.env` now holds** `CONTROL_DATABASE_URL` (`crm_control`), `CLUSTER_BASE_URL`, `ENCRYPTION_KEY`
  (all on the same `crm-railway` cluster). **TO DEPLOY:** add those same three vars to Railway (the
  `ENCRYPTION_KEY` value must match exactly — it decrypts stored connection strings), then commit + push.
  (One benign Turbopack NFT trace warning from the control client under `src/generated` — harmless on
  Railway's persistent Node server.)
- 2026-06-23 — **Deployed to Railway** (push `main` → `e88b584`): global search + combinable filters.
  **Global top-bar search** across companies + contacts via **MongoDB Atlas Search** (`$search` through
  Prisma `aggregateRaw`; `src/lib/search.ts`, route `/api/search`, UI `src/components/global-search.tsx`
  wired into `(app)/layout.tsx`). Dynamic-mapping **"default"** indexes on Company + Contact, created with
  **`npm run search:indexes`** (`scripts/create-search-indexes.ts`) — already created on the live cluster.
  Atlas Search is **free** on all Atlas tiers (M0 ≤3 indexes). **Gotcha:** this cluster returns `[]`
  (no error) for `$search` on a missing/not-yet-built index, so the lib falls back to regex `contains` on
  *empty* results, not just on error. **Suivi visibility fix:** `createContactWithCompany` now stamps
  `datePremierContact = now`, so a hand-added contact shows in Suivi immediately (resolves the open
  question below). **Live filters:** Suivi + Contacts filter bars are URL-driven/debounced (no "Filtrer"
  button) via `useUrlFilters` (`src/lib/use-url-filters.ts`); components `companies-filters.tsx` /
  `contacts-filters.tsx`. **Three combinable text filters** — Nom du contact · Société · Email/téléphone
  (same order on all 3 tabs) — AND with each other and the dropdowns; Pipeline has an equivalent
  **client-side** filter over already-loaded cards (`pipeline-board.tsx`; search strings built in
  `pipeline/page.tsx`). Two-tier model: global bar = "jump to a record" (Atlas, fuzzy); per-page boxes =
  "narrow this list" (regex, compose with the structured filters). `tsc` + `eslint` + `next build` clean.
  - *Local/uncommitted after `e88b584`:* the uniform filter ordering (Nom · Société · Email on all tabs)
    + this roadmap update. Commit + push at the start of next session, or fold into Phase 0's first commit.
- 2026-06-23 — **Deployed to Railway** (push to `main`, auto-deploy): Suivi rework + Nouveau contact flow.
  "Sociétés" tab renamed **Suivi** (sidebar + header; route stays `/companies`). Suivi now shows **only
  engaged prospects** (≥1 activity, or a recorded premier/dernier contact) so it reads as a hot-prospect
  list. New **/contacts/new** page + `createContactWithCompany` action: attach to an existing company OR
  create one inline (hand-added company gets a `MANUEL-<uuid>` placeholder SIRET, since SIRET is
  required+unique as the import dedupe key). Form fields trimmed to what matters: contact = prénom/nom/
  téléphone/email/LinkedIn (+décideur); new-company also captures **site web + spécialités**; dropped
  ville + fonction. "Nouvelle société" CTA → "Nouveau contact" on Suivi; same CTA on Pipeline header.
  **Browser-verified** end-to-end against live Atlas (both branches create + persist correctly; test data
  cleaned up). `tsc` clean.
  - ~~Note: a freshly hand-added contact won't show in Suivi until it has engagement~~ **RESOLVED 2026-06-23**
    (`e88b584`): `createContactWithCompany` now stamps `datePremierContact` on creation, so manual adds
    appear in Suivi immediately.
- **DEFERRED (own task):** user-renamable/deletable **pipeline stages** = move `PipelineStage` from a Prisma
  **enum → config/data** (Phase 1) + edit UI (Phase 2). Touches schema, `Company.stage` migration,
  `lib/constants`, `validations`, `ai-extract` STAGES, funnel, filters. Plan in its own session.
- 2026-06-23 — Deployed to Railway (push to `main`, auto-deploy): config-driven pipeline card
  + architecture/guidance docs now live.
- 2026-06-23 — Pipeline card made config-driven (small Phase-1 down-payment): title/subline
  fields + subline color now read from `src/lib/tenant-config.ts` (`getTenantConfig().pipelineCard`)
  instead of being hardcoded in `pipeline-board.tsx`. Seeded for Christopher = tenant #1
  (title=contact, subline=company in light blue). When the per-tenant config store + DB router
  land, swap only `getTenantConfig` to resolve from the tenant DB — call sites unchanged.
- 2026-06-23 — Architecture + roadmap + CLAUDE.md created. Direction set: multi-tenant,
  config-driven, DB-per-tenant on shared cluster. Phase 0 next.

# Roadmap — single-tenant → multi-tenant platform

> **Cross-session source of truth.** Update the status + checkboxes here as work lands, so any
> freshly-`/clear`ed session knows exactly where things stand. See `docs/architecture.md` for the why.
>
> **This is the platform track** (multi-tenancy, config, billing — the plumbing). The parallel
> **product/UX track** (tasks, follow-ups, outbound, dashboard-as-worklist → "world-class") lives in
> `docs/product-roadmap.md`. P1.3 (Deal object) is meant to fold into **Phase 1** here; P1.1/P1.2
> (outbound + sequences) ride **Phase 3**.

**Current phase: Phase 2 — fields + stages self-serve UI DONE (2026-06-26, code complete,
browser-verified against prod Atlas, not yet committed/pushed).** Christopher (ADMIN) can now add/
edit/delete his own CUSTOM fields and pipeline stages from a `/settings` UI, with guardrails. "Saved
views" remains open (deferred, undesigned — own pass). Next focus = saved views, or finishing the
per-tenant ingestion loop in **Phase 3**.

**Phase 0 — DONE & DEPLOYED to prod (2026-06-24).** The multi-tenant spine + the
pulled-ahead Google OAuth slice are live on Railway (commit `d26b480`); all multi-tenant + `GOOGLE_*`
env vars are set on Railway and the app boots clean multi-tenant in production. Login verified in prod.
The Google slice is now **connected & self-running for ingestion**: owner consent done
(`Ctoppo@avelior.eu` connected) and `/api/cron` is scheduled **every 4h** via an external scheduler
(cron-job.org, `CRON_SECRET` Bearer — deliberately off Railway to save free credit). The **AI insight
pass was reworked to Google Gemini** (free/cheap tier), smoke-tested live, and **committed + pushed
(`3f68ad7`, 2026-06-24)** → Railway auto-deploying (`GEMINI_API_KEY` already set on Railway, so it
activates on deploy). Remaining: **confirm the deploy is green** (`/api/cron` → `ai: enriched`), a
one-time `--backfill` for history, and the ~weekly OAuth reconnect (Testing mode) until publish + CASA.

> **Product is branded "Vision RM"** (repo name `avelior-analytics` is legacy). The owner is an
> independent vendor; **Avelior is customer #1** (`crm_chris`). The Google Cloud OAuth app ("Vision RM")
> lives in the vendor's personal Google account as **External / Testing** (no Workspace org), so refresh
> tokens expire ~7 days until the app is published to Production + passes Google CASA verification
> (gmail is a restricted scope). Test users: `Ctoppo@avelior.eu` + the vendor gmail.

---

## Phase 0 — Spine (multi-tenancy foundation) ✅ deployed
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

## Phase 1 — Config-driven core ✅ *(2026-06-26: config store + custom fields + Deal landed; native fields + stages-as-config landed same day)*
The product itself; Chris's CRM becomes one *config* of it.
- [x] Entity & field-definition model (config stored as data) — `FieldDefinition` collection
      (entity/key/label/type/options/required/showInForm/**source**/**section**), read via
      `lib/field-config.ts getFieldDefs`. `source` ("NATIVE" | "CUSTOM") now distinguishes metadata
      about an existing scalar column from a tenant-added `customFields` field; `section` groups
      fields for rendering.
- [x] Dynamic form + table rendering from config — Company's ~20 NATIVE fields (Identité/Coordonnées/
      Qualification) render via a generic loop (`NativeFieldControl` + `nativeFieldDefaultValue` in
      `components/native-field-control.tsx`) in `company-form.tsx` + `company-inline-editor.tsx`, same
      pattern extended to Contact (`new-contact-form.tsx`, `company-detail-actions.tsx`
      `AddContactForm`). **Deliberately stayed hardcoded** (label≠value enums or layout the generic
      single-line-input renderer doesn't support): `stage` (own StageDefinition control, see below),
      `priorite`/`potentiel`/`canalPrefere` (French-label selects — `FieldDefinition.options` has no
      separate label field yet), specialty checkboxes (8 fixed booleans tied to filter/badge logic),
      `adresse` (full-width span), `notes` (multiline textarea). Sociétés/Contacts **table columns**
      stay curated/hardcoded — reworking which columns a table shows is a Phase 2 "saved views" concern,
      not this pass. Pipeline card seam (`tenant-config.ts`) unchanged.
- [x] Pipeline stages as config — `StageDefinition` collection (key/label/order/accentClass/
      badgeClass/dotClass/isWon/isLost), read via new `lib/stage-config.ts` `getStageDefs()`
      (server/RSC) + `lib/stage-meta.ts` (client-safe `StageDef` type + `stageMetaFrom`/
      `stageLabelsFrom`, split out so client components like `pipeline-board.tsx`/`badges.tsx` don't
      pull in the server-only tenant DB router). `Company.stage` moved from a Prisma `enum
      PipelineStage` to `String` (no data migration needed — Mongo always stored it as a plain
      string). `Deal.stage` was already a string. All ~15 call sites (validations, `ai-extract.ts`
      prompt + STAGES, actions, pipeline board, forms, filters, funnel, dashboard) now read stage defs
      as data instead of importing a static array — unblocks Phase 2's stage editor UI.
- [x] Express Chris's current fields + stages as seeded config — `config:seed` (`scripts/seed-config.ts`)
      seeds the 8 stages + ~20 NATIVE Company fields + 6 NATIVE Contact fields + the original 4 CUSTOM
      Company fields, idempotent by key. Run live against prod Atlas (35 FieldDefinition + 8
      StageDefinition rows).
- [x] Custom-field read/write on flexible documents (no migration) — `customFields Json?` on
      Company/Contact/Deal + `actions/custom-fields.ts setCompanyCustomField`. Verified on prod Mongo.

## Phase 2 — Self-serve customization
Proves the "fully editable" promise on a real user before selling it.
- [x] UI for a tenant to add/edit their own fields — `/settings/fields`, ADMIN-only.
- [x] UI for pipeline stages — `/settings/stages` (drag-reorder); **saved views still open** (deferred,
      undesigned — needs its own pass: view model, per-user vs per-tenant, table-column config).
- [x] Guardrails/validation so self-serve edits can't corrupt data — NATIVE fields undeletable,
      in-use stages undeletable (count shown), duplicate keys rejected with friendly errors.

## Phase 3 — Integrations per-tenant
The moat already exists single-tenant — make it multi-tenant.
- [~] Move integration credentials to per-tenant, encrypted in control plane — **DONE for Google,
      single-tenant.** New control-plane `Integration` model (refresh token AES-256-GCM encrypted via
      `crypto.ts`); helpers in `src/lib/integrations.ts`. Fireflies + AI (Gemini/Claude) creds still env-based.
- [ ] Route `/api/cron` ingestion (Gmail/Calendar/Fireflies + AI insight) to the right tenant DB —
      cron still `getTenant1Prisma()`; it now resolves tenant #1's Google credential (by `TENANT1_SLUG`)
      but does **not** iterate tenants yet. The real per-tenant loop is still open. *(Single-tenant cron
      is now scheduled live — every 4h via cron-job.org → `/api/cron` with the `CRON_SECRET` Bearer.)*
- [~] Per-tenant connect/disconnect UI for each source — **DONE for Google, tenant #1.** Seamless OAuth
      connect/disconnect on the dashboard. Fireflies/Calendar-ICS still env-only.

**Pulled-ahead slice (2026-06-24):** seamless Google (Gmail + Calendar) OAuth — see working log.
**Deployed to prod** (`d26b480`); replaces the manual IMAP App-Password + secret-iCal setup for tenant
#1; legacy env paths remain as fallback. **Owner-consent connect DONE + cron live every 4h (2026-06-24);
AI-insight provider swapped to Gemini but that code is not yet deployed.**

## Phase 4 — Productize & replicate
Replication = "Phase 0 on demand."
- [ ] Self-serve onboarding flow (create tenant → provision DB → seed config)
- [ ] Per-tenant branding + subdomain
- [ ] Billing
- [ ] Onboard customer #2

---

## Working log (newest first)
- 2026-06-26 — **Phase 2: self-serve fields + stages UI (code complete, browser-verified on prod, not
  yet committed/pushed).** New ADMIN-only `/settings` area (`(app)/settings/layout.tsx` gates via
  `requireRole(["ADMIN"])`) with two tabs: **Champs** (`/settings/fields`) and **Étapes**
  (`/settings/stages`). **Fields:** `src/app/actions/field-config.ts` (`createFieldDef`/
  `updateFieldDef`/`deleteFieldDef`) + `field-defs-manager.tsx`/`field-def-form.tsx`. NATIVE fields
  are read-only except label/section (can't delete or retype — they back a real Prisma column);
  CUSTOM fields are fully editable/deletable. **Stages:** `src/app/actions/stage-config.ts`
  (`createStageDef`/`updateStageDef`/`deleteStageDef`/`reorderStageDefs`) + `stage-editor-list.tsx`
  (drag-reorder via existing `@dnd-kit` dep, vertical-list variant of the `pipeline-board.tsx` pattern)
  /`stage-def-form.tsx`. Stage `key` is immutable post-creation (sidesteps in-use-key-rename entirely).
  **Guardrails (server-side, in the actions):** delete rejected for NATIVE fields and for stages still
  referenced by any Company/Deal (friendly error with a live count, e.g. "728 société(s) et 728
  deal(s)"); duplicate `(entity,key)`/stage-key returns a friendly error instead of a Prisma P2002
  crash; all writes gated by `requireRole(["ADMIN"])`. Sidebar gained a "Paramètres" link, ADMIN-only.
  **Bug caught + fixed during browser verification:** both inline forms originally closed
  unconditionally after submit (`await formAction(fd); onDone?.()`), which hid validation errors —
  fixed to only close `onDone()` via a `useEffect` keyed on `state?.ok`, confirmed by reproducing a
  duplicate-key error (stayed open, error visible) then a valid submit (closed, new row appeared).
  **Verified live against prod Atlas:** created+edited+deleted a CUSTOM field (cleaned up after);
  created a new stage, confirmed it appeared as a `/pipeline` column, deleted it, confirmed it
  disappeared from both the settings list and `/pipeline`; tried deleting the in-use "À qualifier"
  stage (728 companies/728 deals) — correctly blocked with the count in the error. **Scoped out**
  (per plan, `docs/roadmap.md` Phase 2 box left open): saved views — no scaffolding exists, needs its
  own design pass. `tsc` + `next build` clean. **Not yet committed** — committing locally this session,
  not pushing to `main` without explicit go-ahead per `CLAUDE.md`.
- 2026-06-26 — **Phase 1 closed out: native-field config-driven rendering + pipeline-stages-as-config.**
  Two-part build, each its own commit (local `main`, not yet pushed):
  **(A) Stages → config.** New `StageDefinition` model (key/label/order/colors/isWon/isLost);
  `Company.stage` enum → `String` (no data migration — Mongo always stored it as a string). New
  `src/lib/stage-config.ts` (`getStageDefs`/`loadStageDefs`, server-only, request-memoized via React
  `cache`) + `src/lib/stage-meta.ts` (client-safe `StageDef` type + `stageMetaFrom`/`stageLabelsFrom`,
  split out so "use client" components like `pipeline-board.tsx`/`badges.tsx` don't pull the
  server-only tenant DB router into the client bundle — hit a Next.js build error first time and fixed
  by the split). All ~15 call sites updated: `validations.ts` (stage is now "non-empty string", real
  allow-list check moved server-side), `ai-extract.ts` (STAGES list + SYSTEM prompt built per-call from
  config, `enrichActivities` fetches via `loadStageDefs(prisma)`), `actions/companies.ts` (new
  `ensureValidStage` helper; `ENUM_FIELDS.stage` removed, special-cased in `setCompanyEnum`),
  `actions/deals.ts`, `api/companies/[id]/stage/route.ts`, `email-research.ts`, `notifications.ts`, and
  client components (`pipeline-board.tsx`, `company-form.tsx`, `company-inline-editor.tsx`,
  `companies-filters.tsx`, `deals-card.tsx`, `badges.tsx`) now take `stages`/`stageDefs` as a prop from
  their server-component parent instead of importing a static array.
  **(B) Native fields → config.** `FieldDefinition` gained `source` ("NATIVE" | "CUSTOM") and `section`
  (form grouping). New `NativeFieldControl`/`nativeFieldDefaultValue` (`components/native-field-control.tsx`)
  render the right `<input>`/`<select>` from a `FieldDef`, slotting into the **same** existing
  `<form>`/Zod-validated submit path (`name={def.key}` matches the Prisma field) — no new write action,
  no UX change, just config-driven JSX generation. Rewired `company-form.tsx`, `company-inline-editor.tsx`,
  `new-contact-form.tsx`, `company-detail-actions.tsx` `AddContactForm`. **Deliberately scoped out**
  (documented inline in the code + Phase 1 section above): `stage`/`priorite`/`potentiel`/`canalPrefere`
  (label≠value enums), specialties (fixed boolean grid), `adresse` (full-width), `notes` (textarea),
  table columns (Phase 2 "saved views" territory). `scripts/seed-config.ts` extended to seed 8 stages +
  ~20 native Company fields + 6 native Contact fields; ran live against prod Atlas, then had to delete 5
  stale `FieldDefinition` rows (adresse/canalPrefere/priorite/potentiel/notes) left over from an
  in-progress seed-list trim — **user approved that one prod deletion explicitly** before running it.
  `tsc` + `next build` green throughout; verified in-browser against live prod data (pipeline board all
  8 stage columns, company fiche/forms render every native field with the right `name`, no console
  errors) — did **not** live-submit a write (the harness correctly blocked a test value into a real
  prod company record; deferred to the user). **Not yet pushed to `main`** — push on explicit go-ahead
  per CLAUDE.md.
- 2026-06-24 — **AI insight → Google Gemini (free/cheap) + ingestion go-live. Committed + pushed
  (`3f68ad7`).** Reworked the AI pass to be **provider-aware** (`src/lib/ai-extract.ts`): `GEMINI_API_KEY`
  wins → else `ANTHROPIC_API_KEY` → else no-op. Gemini path = **OpenAI-compatible endpoint**
  (`…/v1beta/openai/chat/completions`, Bearer, default `gemini-2.5-flash`), **`reasoning_effort:"none"`**
  to kill 2.5-flash thinking tokens (≈4× less billable output in testing, identical results), single
  **429 retry** for free-tier RPM bumps. Shared `parseJsonObject`/`coerceInsight` unchanged (tolerates
  weaker models). Updated `.env.example` (GEMINI_API_KEY/MODEL), `INTEGRATIONS.md` §3, and the
  provider-neutral log/error strings in `sync-all.ts` + `/api/cron`. `tsc` clean; **live smoke-test OK**
  (HTTP 200, valid French JSON). Key in the user's **"Vision RM" GCP project** (320715852987) —
  **billing on = PAID tier** (€10 prepay + €2 budget alert) ⇒ **~€0.15–0.25/mo** at this volume (the GCP
  budget "cap" only ALERTS; the €10 prepay is the real hard stop). **Ingestion go-live DONE:**
  `GEMINI_API_KEY` set on Railway; **Google OAuth connected** (owner consent for `Ctoppo@avelior.eu`);
  **cron every 4h** via **cron-job.org** → `/api/cron` w/ `CRON_SECRET` Bearer (kept off Railway to save
  credit). ✅ **DEPLOYED: committed + pushed `3f68ad7` → Railway auto-deploying** (closed the gap where
  prod `d26b480` ran Claude-only logic that ignored `GEMINI_API_KEY`). Remaining: confirm the deploy is
  green (`/api/cron` → `ai: enriched`); one-time `--backfill` for history; ~weekly OAuth reconnect
  (Testing) until publish + CASA.
- 2026-06-24 — **DEPLOYED Phase 0 spine + Google OAuth slice to prod (`d26b480`).** The multi-tenant
  refactor and the Google OAuth work had been sitting uncommitted on top of the still-single-tenant
  `origin/main` (`e88b584`); this push cuts prod over to multi-tenant in one go. **Atlas:** ran
  `db:push:control` + `db:push` live (additive — new `Integration` collection in `crm_control`,
  `SyncCursor` in `CRM-Railway`; no data moved). **Railway:** added the previously-missing vars —
  `CONTROL_DATABASE_URL`, `CLUSTER_BASE_URL`, `ENCRYPTION_KEY` (must match local exactly — decrypts
  stored conn strings/tokens), `TENANT1_SLUG=crm_chris`, `GOOGLE_CLIENT_ID/SECRET`,
  `GOOGLE_OAUTH_REDIRECT_URI` (prod callback). First login attempt errored only because the old
  single-tenant deploy had none of these; once set, the app booted clean and login works in prod
  (gotcha during testing: the `SEED_ADMIN_*` Railway vars are unused now — real login accounts live in
  the control plane). Google Cloud "Vision RM" OAuth client created (Web app; redirect URIs for
  localhost + prod). **New tool:** `npm run user:add` (`scripts/add-user.ts`) — idempotently
  creates/updates a control-plane login + tenant membership (bcrypt, role, `--tenant`); used it to add
  `ctoppo@avelior.eu` as ADMIN on `crm_chris`. Local build green; static auth-URL check confirmed the
  consent URL (client/redirect/offline + all six scopes). **STILL PENDING (owner runtime):** click
  **Connecter Google** as `Ctoppo@avelior.eu` (pass the Testing-mode "unverified app" screen) → first
  `sync:all`/`/api/cron` round-trip to confirm real Gmail/Calendar ingestion + dedup, then disconnect test.
  `scripts/add-user.ts` + the `user:add` package.json alias are **local-only / uncommitted** for now.
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
  → *Superseded by the 2026-06-24 deploy entry above: Cloud project/client, env vars and both `db:push`es
  are now DONE; only the live connect→sync→disconnect round-trip remains.*
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

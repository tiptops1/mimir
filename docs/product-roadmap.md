# Product Roadmap — from system-of-record to system-of-action

> **Companion to `docs/roadmap.md`.** That file is the **platform track** (multi-tenancy,
> config-driven fields, self-serve, billing — the plumbing that lets us replicate the CRM to other
> customers). *This* file is the **product/UX track**: what makes the daily experience world-class for
> the person actually prospecting. The two run in parallel. Where a product item depends on platform
> work, it's flagged with the platform phase it rides on.
>
> **Update the checkboxes + status here as work lands**, same discipline as the platform roadmap, so a
> freshly-`/cleared` session knows where the product stands.

## North star

> **The CRM tells the user what to do each morning, lets them do it in one click, and the AI keeps the
> record updated on its own.**

We're already ~70% of the way to the hard half — the **auto-updating intelligent record** exists
(Gmail/Calendar OAuth ingestion → activities, Fireflies transcripts, Gemini AI writing
summary/sentiment/next-step/action-items/suggested-stage per activity). The gap is entirely on the
**action** side: tasks, follow-ups, outbound, and a forward-looking home screen. This roadmap closes
that gap.

## Guiding principles (don't violate)

- **Every screen answers "who do I contact next, and when?"** If a view only looks backward (what
  happened), it's a report, not a workspace — pair it with a forward action.
- **Surface the AI we already pay for.** Gemini's `nextStep` / `actionItems` are generated per
  activity today but buried in the detail page. Aggregating and acting on them is the cheapest win we
  have — prefer exposing existing intelligence over computing new things.
- **Config, not code** still holds (see CLAUDE.md). New objects (Tasks, Deals) and new views must be
  expressible as tenant config, not hardcoded to Avelior — define them config-first so Phase 1 doesn't
  have to retrofit them.
- **Don't break the live single-tenant app.** Christopher is in production; the P0/P1 items below are
  pure UX on existing data and can ship on the live app without touching the multi-tenant refactor.

---

## P0 — System of action *(pure UX on existing data; ships on the live single-tenant app now)*

> **Status: ✅ shipped (2026-06-24).** `Task` collection on live Atlas (additive, no data moved);
> committed + pushed to `main` (`cd67ed1`) → Railway auto-deploy. `next build` + `tsc` green. Backend
> verified end-to-end on tenant #1 (Task CRUD + AI dedupe holds). Dashboard worklist strip, `/todo` view,
> and quick-add verified rendering in-browser while authed. The complete-a-task→activity follow-up
> landed too (P0.1). Still to eyeball on a live session: authenticated click-through of toggle-done,
> inline stage, `?all` banner, pipeline chip.

The highest-ROI track. No schema migration beyond the Task object; turns data we already have into a
daily worklist.

### P0.1 — Task / follow-up object + "Aujourd'hui" view ⭐ biggest single win
- [x] `Task` model: `companyId`, `contactId?`, `dueDate`, `type` (RELANCE/APPEL/EMAIL/RDV/AUTRE),
      `done`, `doneAt`, `note`, `source` (MANUAL | AI_NEXTSTEP), `activityId` dedupe key. In
      `prisma/tenant/schema.prisma`; string enums (config-friendly, matches `Activity.type`).
- [x] **Auto-seed tasks from Gemini's `nextStep`** in `enrichActivities` (`lib/ai-extract.ts`), guarded
      by an `activityId` `findFirst` dedupe so cron re-runs never duplicate. Created undated → "À planifier".
      *(Note: this path silently never ran in prod until the 2026-06-25 Mongo `isSet` fix — see working log.)*
- [x] **"À faire"** view (`/todo`, new nav item + overdue/today badge): buckets En retard / Aujourd'hui /
      À venir / À planifier; one-click "Fait" (`toggleTask`) + "Reporter" (`snoozeTask`). Actions in
      `src/app/actions/tasks.ts`; reusable `components/task-list.tsx` + `components/new-task-form.tsx`.
- [x] Complete-a-task logs a matching activity — `toggleTask` (open → done) creates an Activity with
      the type mapped from the task (APPEL→CALL, EMAIL→EMAIL, RDV→MEETING, RELANCE/AUTRE→NOTE) and
      bumps `dernierContact`, so the timeline + staleness/relance widgets stay accurate.

### P0.2 — Rework the dashboard into a work surface
- [x] Forward-looking strip now leads: "À faire aujourd'hui" (overdue+today tasks, reused `TaskList`) +
      "Prospects à relancer" (engaged, last touch > 30 j, not won/lost). KPIs / pipeline / recent
      activity moved below as the reporting strip.
- [x] Each forward widget links into the actionable list (`/todo`, the prospect's fiche).

### P0.3 — Quick-add & inline actions everywhere
- [x] Global **"+ Nouveau"** menu in the top header (`components/quick-add-menu.tsx`) → new task /
      contact / société. *(Company-less inline call-log deferred — needs a global company picker.)*
- [x] **Inline stage change on the company detail page** — header `StageBadge` swapped for `EnumCell`
      (`field="stage"`, already wired to `setCompanyEnum`). Also added a "Tâches" card with `NewTaskForm`.
- [x] Pipeline cards: last-touch staleness chip + "Relance" dot when an open task exists
      (`pipeline/page.tsx` select + `pipeline-board.tsx` `CardView`).

### P0.4 — IA / naming cleanup (low effort, removes daily friction)
- [x] Suivi label clarity: subtitle now reads "N prospects engagés" vs "N sociétés (toutes)".
- [x] Suivi "voir tout": `?all=1` lifts the engagement gate; banner shows "X sociétés masquées · Tout
      afficher" (and the reverse toggle) so empty ≠ filtered (`companies/page.tsx`).

### P0.5 — Inbox quality + comprehensive filters everywhere *(shipped 2026-06-25)*
> **Status: ✅ shipped & deployed** (`main` — commits `c063e5c`/`4ba87cc`/`bb71ddd`); `BlockedSender`
> index pushed to prod via `db:push` (2026-06-25). `tsc` clean; verified in-browser against live data.

The inbox review queue (`PendingContact`) only shows **quality** senders, and every list view has
combinable filters.
- [x] **Two-layer anti-spam at ingestion** so spam never enters the CRM. Header signals
      (`detectBulk` in `mime-email.ts`: list-unsubscribe/list-id/precedence/auto-submitted/feedback-id…)
      + sender heuristics in `email-sync.ts` (`isAutomatedSender` noreply/donotreply…, `looksLikePerson`
      prenom.nom guard, `ROLE_TOKENS` denylist). `processEmail` gate drops bulk/automated non-persons
      (`filtered++`). One-time cleanup script `scripts/clean-inbox-spam.ts` (`npm run clean:inbox`)
      dismissed 42 of 109 existing pending.
- [x] **"Spam" action** (`markPendingSpam`) → permanent `BlockedSender` block list (address **+**
      domain unless free-domain); `buildCaches` loads it so blocked senders never re-enter. Dismisses
      same-domain siblings immediately. New `BlockedSender` model (`value @unique`, `kind`, `@@index`).
- [x] **Auto-expire stale pending** — `expireStalePending` dismisses PENDING with `lastSeen` older than
      **14 days** at every sync (Gmail + IMAP), so the queue stays fresh and old entries don't resurface.
- [x] **Add a task straight from an inbox email** (`createTaskFromPending`) — promotes the sender to a
      contact/company and creates a follow-up Task in one step (`inbox-actions.tsx` mini-form).
- [x] **Comprehensive combinable filters on every list** (the standing "all pages have filters" rule):
      Inbox (`inbox-filters.tsx`: text · direction · min message count · seen-since), Todo
      (`todo-filters.tsx`: title · société · type · source), all URL-driven via `useUrlFilters`;
      Pipeline gains client-side priorité/potentiel/open-task selects.

---

## P1 — Close the prospecting loop *(the moat compounds here)*

> **Status: ✅ shipped & deployed (2026-06-26).** P1.1–P1.4 all live on `main` → Railway. Outbound
> AI-researched email, the Deal object, sequences, and notifications + digest landed in one push.

Where the auto-ingestion advantage turns into an outbound advantage.

### P1.1 — Outbound email from the CRM ✅ *(shipped single-tenant; gmail.send already granted)*
- [x] **send** scope already on the Gmail OAuth (`gmail.send` in `GOOGLE_SCOPES`) — no re-consent.
- [x] Compose + send from the contact on the company fiche (`email-composer.tsx` →
      `actions/email.ts sendEmail` → `lib/gmail-send.ts`); the sent mail logs as an OUTBOUND EMAIL
      activity (own Message-ID so the next sync dedupes) and bumps `dernierContact`.
- [x] ⭐ **AI-generate a researched draft** — "Générer avec IA" builds a documented dossier
      (`lib/email-research.ts`: CRM record + activity history with AI summaries + live web research via
      recherche-entreprises.gouv.fr + the firm's website) and drafts a tailored email via Gemini.
- [ ] Email templates (tenant config) — not done; the AI composer largely supersedes it.

### P1.2 — Sequences / cadences ✅
- [x] Multi-touch cadence (`Sequence`/`Enrollment` models; `lib/sequences.ts advanceSequences` in the
      cron) auto-creating tasks. **Auto-send is OFF by design** — EMAIL steps create a task the user
      actions via the AI composer. Seeded "Prospection standard" (email→call→LinkedIn→email, 0/3/7/14 j).
- [x] Enroll/pause/skip from the company fiche (`sequences-card.tsx`, `actions/sequences.ts`).

### P1.3 — Deal / Opportunity object ✅ *(additive write-through; folded alongside Phase 1)*
- [x] `Deal` model (stage/product/amount/status/isPrimary); a company can hold parallel/historical
      opportunities. The board stays company-keyed via primary-deal write-through
      (`lib/deals.ts`); `scripts/backfill-deals.ts` seeded 731 primary deals. "Affaires" card on the fiche.
- [x] Done before the Phase 1 config model hardened, per CLAUDE.md.

### P1.4 — Notifications ✅
- [x] In-app header **bell** (`notifications-bell.tsx`, `lib/notifications.ts`) — count of overdue/today
      tasks + prospects to relance, from existing data (no new model).
- [x] **Email digest** (`lib/digest.ts sendDailyDigest`, cron-guarded once/day via `SyncCursor "digest"`)
      to the owner's mailbox via `gmail-send`.

---

## P2 — Scale & polish

> **Status: ✅ COMPLETE & DEPLOYED (2026-07-01, `91350b9` → `main` → Railway).** First slice
> (responsive shell + command palette + CSV export) shipped earlier that day; the second slice closed
> everything else: dark mode, PWA, bulk actions, saved views, dedupe+merge, analytics v2 (StageChange
> log), RGPD (consent/export/erase/audit). Only P2.3's per-rep leaderboard waits on real multi-user
> usage. **`npm run db:push` run against prod** (SavedView + StageChange collections/indexes;
> AuditLog + Contact.consent lazy-create on first write).

### P2.1 — Mobile & speed
- [x] **Responsive shell** *(2026-07-01)* — static sidebar hidden below `lg`, slide-over drawer
      (`components/mobile-sidebar.tsx`) behind a topbar hamburger; closes on navigation (Esc/overlay
      too); topbar + page-header padding responsive. Verified at 375px.
- [x] **Command palette** *(2026-07-01)* — the ⌘K bar (`global-search.tsx`) is now a real palette:
      page navigation + quick actions (nouvelle tâche / contact / société) + record search in one
      keyboard-navigable list; accent-insensitive command filtering; "Paramètres" entry is ADMIN-only
      (layout passes `isAdmin`).
- [x] **PWA** *(2026-07-01)* — `src/app/manifest.ts` (installable, start_url `/dashboard`), brand
      icons generated from the BrandMark by `scripts/generate-icons.mjs` (192/512/maskable +
      apple-icon, via the bundled sharp), minimal `public/sw.js` (navigations network-first with
      `offline.html` fallback; `/_next/static` cache-first; CRM data never cached), registered
      production-only by `pwa-register.tsx` in the root layout.
- [x] **Dark mode** *(2026-07-01)* — `[data-theme="dark"]` token swap in `globals.css` (surfaces/
      text/borders/brand/semantic/shadows/scrollbars, `color-scheme: dark`) + a **compat layer**
      remapping the literal hue utilities that live as DATA in the tenant DB (StageDefinition
      `badgeClass` strings like "bg-sky-100 text-sky-700") since those can't be tokenized in code.
      Literal `bg-white`/`ring-indigo-100`/indigo fills in code swept to tokens (`bg-card`,
      `ring-brand-subtle`, `brand-subtle` — visually identical in light). Toggle in the topbar
      (`theme-toggle.tsx`, localStorage-persisted, pre-paint inline script in the root layout so no
      flash; default stays light).

### P2.2 — Working at scale (731+ companies)
- [x] **CSV export** *(2026-07-01)* — "Exporter" on Suivi + Contacts headers; `/api/export?type=
      companies|contacts` honors the exact on-screen filters (where-builders extracted to
      `lib/list-filters.ts`, shared by pages + route so they can't drift), UTF-8 BOM + `;` separator
      (Excel FR), étape/priorité/potentiel resolved to labels, 5 000-row cap, authed.
- [x] **Bulk actions** *(2026-07-01)* — checkbox column + select-all on the Suivi table
      (`bulk-select.tsx`: BulkProvider context, page-local selection) with a floating bar (count,
      Étape/Priorité/Potentiel dropdowns, clear). `bulkSetCompanyEnum` in `actions/companies.ts`
      reuses the single-row validation incl. primary-deal stage write-through; 500-id safety cap.
- [x] **Saved views / segments** *(2026-07-01)* — new `SavedView` model (per-user, per page; stores
      the live URL querystring verbatim, so applying = navigation and the filter schema isn't
      duplicated). Chip row above the Suivi/Contacts filters (`saved-views.tsx`): click to apply
      (active state), hover-x to delete, "Enregistrer la vue" appears when the current filters
      aren't saved. Actions in `actions/saved-views.ts` (owner-scoped delete, 20-view cap).
      Additive `db:push` run against prod (SavedView + index).
- [x] **Duplicate detection & merge** *(2026-07-01)* — new ADMIN tab `/settings/duplicates`.
      Conservative exact-key detection (`lib/dedupe.ts`): companies by normalized name (accents/
      punctuation/legal forms stripped, ≥5 chars) or website domain; contacts by email. Merge
      (`actions/dedupe.ts`) reattaches contacts/activities/tasks/deals/enrollments/finance entries
      to the keeper, keeps exactly one primary deal, fills the keeper's blanks (earliest premier /
      latest dernier contact, notes concatenated, customFields keeper-wins), then deletes the shells.
      Detection on live data surfaced 7 real company groups — merging them is Christopher's call.

### P2.3 — Analytics v2 *(time dimension + multi-user)*
- [x] Time dimension *(2026-07-01)* — new **`StageChange`** transition log (from/to/at/userId,
      written by `lib/stage-history.ts` from ALL six Company.stage write paths: create, form update,
      inline EnumCell, bulk bar, pipeline drag PATCH, primary-deal setDealStage; dedupe-merge moves
      rows, deleteCompany cleans them). `/analytics` gained a **"Dynamique du pipeline"** section
      (`lib/analytics-v2.ts`): temps moyen dans l'étape (falls back to createdAt until history
      accrues, exact thereafter), volume d'activités 12 semaines, conversions entre étapes 90 j,
      gagnés vs perdus par mois (`DualBars`). History builds from deploy day — a hint says so until
      the first real transition. **`npm run db:push` still needed** for the StageChange indexes
      (collection itself is lazy-created; classifier blocked the prod migration this session).
- [ ] Per-rep **leaderboard** — once multi-user is actually in daily use (needs >1 active rep).

### P2.4 — RGPD / compliance *(legal table-stakes + a Phase 4 sales argument)*
- [x] *(2026-07-01)* **Consent tracking** — `Contact.consent` (OPT_IN/OPT_OUT/null) + `consentAt`,
      inline RGPD column on Contacts (`rgpd-cell.tsx`). **Export** (droit d'accès) —
      `/api/rgpd/export?contactId=` (ADMIN, audited) returns contact + activités + tâches as JSON.
      **Erase** (droit à l'effacement, ADMIN + confirm) — `eraseContact` deletes the contact, scrubs
      its email off activities, unlinks tasks/enrollments, drops pending-inbox rows AND blocks the
      address (`BlockedSender`) so a future sync can't silently recreate the erased person.
      **Audit log** — append-only `AuditLog` (`lib/audit.ts`), written by RGPD actions + merges +
      company deletion; viewer at `/settings/audit` (latest 200, author names from the control
      plane). Verified live: consent round-trip + export 200 + entries visible in the journal.
      *(`npm run db:push` pending for the AuditLog/consent indexes — collections lazy-create.)*
- [x] Becomes a concrete selling point when replicating to customer #2 — documented here, demoable
      from `/settings/audit`.

---

## P3 — Finances: the business cockpit *(new track — from system-of-action to one-stop pilot)*

> **Status: ✅ shipped & deployed (2026-06-26)** — `main` (`a4eed07`) → Railway auto-deploy. Additive
> `db:push` run live against prod Atlas (`FinanceEntry` + `Setting` collections + indexes;
> `Task.financeEntryId` index) and `config:seed` run (FINANCE category). `tsc` + `eslint` +
> `prisma validate` + **full `next build` green**. Browser/live click-through still to be eyeballed once
> the deploy lands.
>
> Turns the CRM from a prospecting tool into the place a solo owner pilots the whole business from: the
> revenue side already existed (deals/pipeline/won amounts); this adds the **cost side** and ties both
> into a P&L cockpit. Built additive + config-first per `CLAUDE.md`, on the live single-tenant app
> (`Task.companyId` relaxed to optional so finance alerts need no company).

The north-star principle still holds — every finance screen leads with a **forward action** (what's
about to cost or pay), not a backward report.

### P3.1 — One flexible `FinanceEntry` model + cockpit
- [x] `FinanceEntry` (`direction` OUT/IN × `kind` SUBSCRIPTION/STAFF/EXPENSE/INVOICE; amount in euros,
      recurrence, status, trial/renew/due dates, optional CRM `company` link, `customFields`). One model,
      four lenses — mirrors how `Deal`/`Activity` carry type-specific nullable fields.
- [x] `/finances` cockpit: KPI strip (revenu / coûts / **net mensuel** / **trésorerie + autonomie**),
      Échéances radar (next 30 j), cost-by-category Donut, and a segment-filtered, **inline-editable**
      table (status badge dropdown + click-to-edit amount, reusing the `EnumCell`/`useTransition`
      pattern). Detail/edit page at `/finances/[id]`.
- [x] P&L strip on the home dashboard (`FinanceKpiStrip`): revenue vs costs vs net + runway, with
      open-deal pipeline as the forward revenue figure. Editable cash-on-hand (`Setting` store).

### P3.2 — Renewal / trial / invoice radar → tasks → bell → digest
- [x] `advanceFinanceAlerts` in `/api/cron` materializes trial-ends / renewals / invoices-due into
      `Task`s (`source: "FINANCE"`, deduped by `financeEntryId`), which flow into `/todo`, the header
      bell, and the daily digest for free. `Task.companyId` made optional so finance tasks need no company.

### P3.3 — Config + follow-ons
- [x] Categories seeded as config (`FieldDefinition` entity `FINANCE`), read by the page.
- [x] Surface entity `FINANCE` in the `/settings/fields` self-serve editor *(2026-07-01)* — new
      "Finances" card (ConfigEntity + VALID_ENTITIES + settings page); the seeded Catégorie select is
      NATIVE so its options are editable but the def can't be deleted; `/finances` revalidated on edits.
- [ ] Out of scope (v1, each a clean follow-on): receipt/file upload + OCR, bank/Stripe import, TVA
      reporting, PDF invoice generation, multi-currency conversion.

---

## P5 — Cold outreach automation *(built + probe-tested; NOT committed, NOT shipped)*

> **Status: code-complete in the working tree, uncommitted (29 files as of 2026-07-14).** A separate
> OUTREACH Google identity sends multi-touch cold sequences to Lead One prospects, with reply/bounce
> sync, an auto-pause breaker, and public opt-out. Backed by real DB probes (30 engine + 18 reply +
> 13 opt-out checks). **Ship is blocked on owner setup, not code** — see go-live below.

WP1–WP8 (one line each; the code is the record):
- **WP1** — schema + plumbing: `Integration.purpose` (MAIN/OUTREACH), `OutreachMessage`, `OutreachConfig`,
  `Sequence.mode`, `Contact.emailStatus`; backfill; **`db:push` already applied to Atlas**.
- **WP2** — OUTREACH connect flow: 2nd Google card at `/settings/integrations`, separate `GOOGLE_OUTREACH_*`
  client (Internal consent screen → no 7-day token death).
- **WP3** — sequence editor (`/outreach/sequences`): adaptive template vars, subject on first mail only,
  "Re:" follow-ups, live preview. Chris's 4-step "Cold email courtiers santé" created via the UI.
- **WP4** — send engine: French business-day math, hourly `/api/cron/outreach`, spread budget, threading,
  ledger + timeline Activity + `dernierContact` bump.
- **WP5** — reply/bounce sync + breaker: threadId match → REPLIED exit + "Répondre" task + hot alert;
  BOUNCED → `emailStatus="INVALID"`; 7-day bounce-rate breaker → pause flag + red banner (ADMIN resume).
- **WP6** — opt-out: public HMAC `/api/outreach/unsubscribe`, List-Unsubscribe + footer → BlockedSender +
  consent OPT_OUT + AuditLog.
- **WP7** — enrollment: shared `canEnroll` gate at the fiche, bulk enroll on Suivi, Lead One auto-enroll.
- **WP8** — dashboard `/outreach`: 5 metrics, funnel, recent sends, config form (cap, warm-up, window,
  holidays, threshold, auto-enroll picker, unsubscribe text).

### Go-live prerequisites *(owner-owned, not code)*
1. **Sending identity — DECIDED 2026-07-14: Option A.** Send cold outreach from a **dedicated
   `avelior.eu` mailbox** (e.g. `prospection@avelior.eu`) on Christopher's existing Google Workspace
   (confirmed on Google MX). *Why a dedicated mailbox:* keeps replies/bounces out of Christopher's
   personal inbox (WP5 scans this mailbox). **No new domain needed** — the earlier "buy get-avelior.com"
   step is **dropped**: the avelior.eu Workspace already lets us create the **Internal** OAuth client
   (permanent token, no 7-day death), which was the only reason a domain purchase was ever on the list.
2. **Christopher (Workspace/GCP admin) creates** the dedicated mailbox + an **Internal** OAuth client in
   the avelior.eu org, then hands over client id / secret / redirect URI.
3. Set `GOOGLE_OUTREACH_*` env vars on Railway.
4. Add an hourly cron-job.org call → `/api/cron/outreach` with the `CRON_SECRET` Bearer.

Then say "push" → `/ship` (schema `db:push` already run, so it no-ops).

### Deferred add-on — Option B: separate sending domain *(deliverability isolation)*
- [ ] **When prospect volume grows**, move cold sending to a **separate throwaway domain** (e.g.
  `get-avelior.com`) with its own SPF/DKIM/DMARC, so spam complaints can't degrade avelior.eu's
  reputation for Christopher's real client mail. **Skipped for v1 by owner decision (2026-07-14):**
  low volume + targeted, personalised mail makes the shared-domain risk minor for now. Revisit as
  send volume climbs.

---

## How this interleaves with the platform roadmap

| Product item | Depends on / rides | Can ship now? |
|---|---|---|
| P0.1–P0.4 (system of action) | nothing — existing single-tenant data | ✅ yes |
| P1.1 Outbound email | platform **Phase 3** (per-tenant encrypted creds) | with Phase 3 |
| P1.2 Sequences | P0.1 tasks + P1.1 send | after P1.1 |
| P1.3 Deal object | platform **Phase 1** (define as config from the start) | with Phase 1 |
| P1.4 Notifications | P0.1 tasks | after P0.1 |
| P2.4 RGPD | platform **Phase 4** (replicate / sell) | with Phase 4 |

**Recommended order:** ship **P0 entirely on the live app first** (no platform dependency, biggest
daily-experience lift), fold **P1.3 (Deal)** into Phase 1 as it's being designed, and bring **P1.1/P1.2**
online with Phase 3's per-tenant integration work.

---

## Working log (newest first)
- 2026-07-01 — **P2 first slice: responsive shell + command palette + CSV export, plus the open P3.3
  settings box (shipped & deployed).** (1) **Mobile:** static sidebar `hidden lg:flex`; new
  `components/mobile-sidebar.tsx` slide-over drawer (hamburger in the topbar, closes on
  navigation/Esc/overlay, `animate-drawer` keyframe in `globals.css`); Sidebar gained a `className`
  prop; topbar + `page-header.tsx` padding responsive. (2) **Command palette:** `global-search.tsx`
  rewritten — ⌘K now opens a palette with page navigation + quick actions + record search in one
  keyboard-navigable list (accent-insensitive filtering; ADMIN-only "Paramètres"; off-token
  `bg-white`/`indigo-*` classes swapped for tokens here and in `quick-add-menu.tsx`; fixed the
  long-standing `react-hooks/set-state-in-effect` lint error via the adjust-during-render pattern).
  (3) **CSV export:** Suivi/Contacts where-builders extracted to `lib/list-filters.ts` (pages + new
  authed `/api/export` route share them so list and export can't drift); UTF-8 BOM + `;` for Excel FR;
  stage/priorité/potentiel resolved to labels; "Exporter" buttons carry the live filter querystring.
  (4) **P3.3:** FINANCE entity surfaced in `/settings/fields`. **Verified in-browser on live data:**
  palette (empty-state commands, filtering, record search → Enter → fiche), drawer at 375px
  (open/nav/close), both CSV endpoints (200, BOM bytes `EF BB BF`, filters honored, correct
  filenames), Finances card in settings, desktop layout intact at 1280px, zero console errors.
  `tsc` + `eslint` + full `next build` green. No schema changes — pure code, no `db:push` needed.
- 2026-06-26 — **P3 Finances cockpit — shipped & deployed (new product track).** Evolved the CRM from a
  prospecting tool into a one-stop business cockpit by adding the **cost side** and tying it to revenue.
  **One flexible `FinanceEntry`** model (`direction` OUT/IN × `kind` SUBSCRIPTION/STAFF/EXPENSE/INVOICE;
  euros, recurrence, status, trial/renew/due dates, optional CRM `company` link, `customFields`) + a tiny
  `Setting` key/value store (trésorerie). **`/finances`**: KPI strip (revenu / coûts / net mensuel /
  trésorerie + autonomie via `FinanceKpiStrip`, shared with the dashboard), 30-day **échéances radar**,
  cost-by-category Donut, and an **inline-editable** segment-filtered table (status badge dropdown +
  click-to-edit amount, reusing the `EnumCell`/`useTransition` pattern); detail/edit at `/finances/[id]`.
  Server math in `lib/finance-cockpit.ts`; client-safe meta/`monthlyAmount` in `lib/finance.ts`;
  `formatCurrency` added to `lib/display.ts`. **Alert engine reuse:** `advanceFinanceAlerts`
  (`lib/finance-alerts.ts`) in `/api/cron` materializes trial-ends / renewals / invoices-due into
  `FINANCE` `Task`s (deduped by `financeEntryId`) → `/todo` + bell + digest for free; **`Task.companyId`
  relaxed to optional** (`toggleTask` already guarded it, so additive + safe). FINANCE category seeded as
  config (`scripts/seed-config.ts`). All schema changes additive `db:push` to prod (FinanceEntry + Setting
  collections + indexes, Task.financeEntryId index); `config:seed` run live. `tsc` + `eslint` +
  `prisma validate` + **full `next build` green**. **Deployed:** committed + pushed `a4eed07` → `main`
  (alongside the previously-held Phase 1/2 commits, per owner go-ahead) → Railway auto-deploy. **Still to
  eyeball on a live authed session:** create one of each kind, inline edits, the radar, and a cron-seeded
  finance task. **Open follow-ons:** surface entity `FINANCE` in `/settings/fields`; out of scope for v1 —
  receipt upload/OCR, bank/Stripe import, TVA reporting, PDF invoices, multi-currency.
- 2026-06-26 — **P1 shipped in one push (outbound AI email + Deal + sequences + notifications).**
  Five-stage build, each additive + verified + deployed to `main`:
  (1) **Outbound + AI-researched email** — `email-composer.tsx` on the fiche; "Générer avec IA" builds a
  documented dossier (CRM + activity AI summaries + live registry/website research, `lib/email-research.ts`)
  and drafts via the shared `callModel`; send via `lib/gmail-send.ts`, logged as OUTBOUND with our own
  Message-ID (sync dedupes). (2) **Deal object** — additive `Deal` with primary-deal↔company.stage
  write-through (`lib/deals.ts`); `deals:backfill` seeded 731. (3) **Config core** — `FieldDefinition`
  store + flexible `customFields` Json + `CustomFieldsSection` (`config:seed`). (4) **Sequences** —
  `Sequence`/`Enrollment`, `advanceSequences` in cron materializes tasks, auto-send OFF. (5) **Notifications**
  — header bell + daily `sendDailyDigest` (cron-guarded). All schema changes additive `db:push` to prod
  (Deal, FieldDefinition, Sequence, Enrollment collections). tsc + eslint + next build green throughout;
  research/write-through/custom-field/sequence engines each verified on throwaway prod records. Commits
  `889f2d4`/`fa251be`/`ef9029b`/`65d8274` + this stage. **Live send + AI compose run with the prod Gemini
  key remain the owner's to exercise** (key is Railway-only; first send should go to a controlled address).
- 2026-06-25 — **AI enrichment was silently dead in prod — found & fixed (shipped & deployed).** The
  "auto-updating intelligent record" the North star depends on had **never actually run in production**:
  `enrichActivities` (`lib/ai-extract.ts`) filtered `aiSummary: null`, but on **MongoDB a `: null` Prisma
  filter does not match a *missing* field**, and activity docs are created without an `aiSummary` field —
  so the query matched 0 rows every cron run and Gemini enriched nothing (no summaries, no sentiment, no
  auto-seeded `nextStep` tasks), despite the key being live. Fix = `aiSummary: { isSet: false }`. Same
  null-vs-missing gotcha fixed in the three `dernierContact` last-contact `updateMany`s
  (calendar/email/fireflies — added `{ dernierContact: { isSet: false } }`). Also tightened the SYSTEM
  prompt so `suggestedStage` = the last stage actually reached, never a planned one (was over-advancing
  planned demos to DEMO_REALISEE). **Verified live against prod Atlas** (local `.env` → prod) with the
  Gemini key: **4 real Gmail activities enriched + 3 RELANCE/AI_NEXTSTEP tasks auto-created**. Added a
  read-only probe `scripts/test-ai-insight.ts`. `tsc` clean. **Deployed:** `main` (`41ac37f`) → Railway
  auto-deploy; the 4h cron now genuinely keeps the record updated on its own. Model stays `gemini-2.5-flash`
  (Flash, not Pro — deliberate cost choice). Confirm green via `…/api/cron?key=<CRON_SECRET>` → `ai: { enriched }`.
- 2026-06-25 — **P0.5 — inbox quality + filters everywhere (shipped & deployed).** Built a two-layer
  anti-spam pipeline so only quality senders reach the `PendingContact` review queue: header-based
  `detectBulk` (`mime-email.ts`) + sender heuristics (`isAutomatedSender` / `looksLikePerson` /
  `ROLE_TOKENS`) gating `processEmail` in `email-sync.ts` (drops counted as `filtered`). Added a
  permanent **`BlockedSender`** block list (address + domain) consumed by `buildCaches`, surfaced as a
  one-click **Spam** action (`markPendingSpam`) that also dismisses same-domain siblings; one-time
  `npm run clean:inbox` dismissed 42/109 existing pending. Added **14-day auto-expire** of stale pending
  (`expireStalePending`, runs at every Gmail/IMAP sync). Added **task-from-email**
  (`createTaskFromPending` — promote sender → contact/company + create Task). Added comprehensive
  URL-driven filters on Inbox + Todo and client-side filters on Pipeline, fulfilling the "every page has
  filters for its content" rule. `tsc` clean; verified in-browser on live data. **Deployed:** `main`
  (`c063e5c`/`4ba87cc`/`bb71ddd`); ran `db:push` against prod to create the `BlockedSender` collection +
  unique/`kind` indexes (additive, no data moved).
- 2026-06-24 — **P0.1 follow-up: complete-a-task now logs an activity.** `toggleTask` (`actions/tasks.ts`)
  on an open→done transition creates a matching Activity (task type → CALL/EMAIL/MEETING/NOTE, note
  "Tâche terminée : …", authored by the session user) and stamps `dernierContact = now` — mirrors
  `addActivity`. Un-completing leaves the activity in place. `tsc` clean. Closes the last open P0.1 box.
- 2026-06-24 — **P0 implemented (code complete, on live Atlas, not yet committed/deployed).** Added the
  `Task` model (additive `db push` to tenant #1 — Task collection + 3 indexes, zero data moved) and the
  full "system of action" layer: `src/app/actions/tasks.ts` (create/toggle/snooze/setDue/delete),
  `/todo` view with 4 due-buckets + sidebar nav/badge, reusable `task-list.tsx` + `new-task-form.tsx`,
  AI auto-seed from `Activity.nextStep` in `enrichActivities` (deduped by `activityId`), dashboard
  worklist strip (À faire aujourd'hui + prospects à relancer), global "+ Nouveau" menu, inline stage
  `EnumCell` + Tâches card on the company fiche, pipeline-card staleness/relance chips, and Suivi
  `?all=1` "voir tout" banner. `tsc` + `next build` green (only the pre-existing enum-cell/global-search
  lint warnings remain). **Verified:** Task CRUD + AI dedupe (1 task, not 2) end-to-end on live Atlas via
  a throwaway script (since deleted); dashboard/`/todo`/quick-add render correctly in-browser. The
  preview session expired mid-test, so authenticated click-through of toggle/inline-stage/banner/chip is
  still to be eyeballed. **Next:** owner review → commit + push (deploy to Railway) on explicit go-ahead;
  then the deferred "log activity on task-complete" follow-up. The undated AI tasks land in "À planifier".
- 2026-06-24 — Product roadmap created from a UX/flow review of the live app (dashboard, Suivi,
  Pipeline, company detail, inbox, analytics). Core finding: the app is a strong *system of record*
  (AI-enriched auto-ingested timeline) but not yet a *system of action* (no tasks/follow-ups, dashboard
  looks only backward). P0 track defined to close that gap on the live single-tenant app.
</content>
</invoke>

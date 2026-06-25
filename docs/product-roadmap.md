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

### P2.1 — Mobile & speed
- [ ] **Responsive / PWA** — sidebar is fixed `w-60` with no collapse or mobile drawer; prospecting
      happens on the phone / on the road.
- [ ] **Command palette + keyboard shortcuts** for a daily power tool.

### P2.2 — Working at scale (731+ companies)
- [ ] **Bulk actions** (select N → change stage / assign / export).
- [ ] **Saved views / segments.**
- [ ] **Duplicate detection & merge.**

### P2.3 — Analytics v2 *(time dimension + multi-user)*
- [ ] Today's analytics are a point-in-time snapshot. Add: **stage velocity** (time stuck per stage),
      conversion-between-stages, activity volume, win-rate **trend**, and per-rep **leaderboard** (once
      multi-user is live).

### P2.4 — RGPD / compliance *(legal table-stakes + a Phase 4 sales argument)*
- [ ] FR insurance = sensitive data: per-contact **consent tracking**, **export/erase**, **audit log**.
- [ ] Becomes a concrete selling point when replicating to customer #2.

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

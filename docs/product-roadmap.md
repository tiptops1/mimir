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

> **Status: ✅ code complete + on live Atlas (2026-06-24).** `Task` collection pushed (additive, no data
> moved); `next build` + `tsc` green. Backend verified end-to-end on tenant #1 (Task CRUD + AI dedupe
> holds). Dashboard worklist strip, `/todo` view, and quick-add verified rendering in-browser while
> authed. **Not committed/deployed** — awaiting owner go-ahead. Full authenticated click-through (toggle
> done, inline stage, `?all` banner, pipeline chip) still to be eyeballed on a live session.

The highest-ROI track. No schema migration beyond the Task object; turns data we already have into a
daily worklist.

### P0.1 — Task / follow-up object + "Aujourd'hui" view ⭐ biggest single win
- [x] `Task` model: `companyId`, `contactId?`, `dueDate`, `type` (RELANCE/APPEL/EMAIL/RDV/AUTRE),
      `done`, `doneAt`, `note`, `source` (MANUAL | AI_NEXTSTEP), `activityId` dedupe key. In
      `prisma/tenant/schema.prisma`; string enums (config-friendly, matches `Activity.type`).
- [x] **Auto-seed tasks from Gemini's `nextStep`** in `enrichActivities` (`lib/ai-extract.ts`), guarded
      by an `activityId` `findFirst` dedupe so cron re-runs never duplicate. Created undated → "À planifier".
- [x] **"À faire"** view (`/todo`, new nav item + overdue/today badge): buckets En retard / Aujourd'hui /
      À venir / À planifier; one-click "Fait" (`toggleTask`) + "Reporter" (`snoozeTask`). Actions in
      `src/app/actions/tasks.ts`; reusable `components/task-list.tsx` + `components/new-task-form.tsx`.
- [ ] Complete-a-task → optionally log the resulting activity in the same step. *(deferred — small follow-up)*

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

---

## P1 — Close the prospecting loop *(the moat compounds here)*

Where the auto-ingestion advantage turns into an outbound advantage.

### P1.1 — Outbound email from the CRM *(rides platform Phase 3 — per-tenant creds)*
- [ ] Add **send** scope to the existing Gmail OAuth (today ingestion is read-only — a prospecting
      tool that can't send is half a tool).
- [ ] Compose + send from the company/contact view; the sent mail lands back in the activity timeline.
- [ ] **Email templates** (tenant config).

### P1.2 — Sequences / cadences
- [ ] Multi-touch cadence (e.g. day 0 email → day 3 call task → day 7 LinkedIn), auto-creating tasks
      (P0.1) and sends (P1.1). This is the Outreach/Salesloft core, scoped to the FR insurance vertical.
- [ ] Enroll/pause/skip from the company or a list.

### P1.3 — Deal / Opportunity object *(fold into platform Phase 1's entity/field config)*
- [ ] Split stage off `Company` into a `Deal` (a company re-prospected across renewals / products —
      santé this year, prévoyance next — needs parallel + historical opportunities).
- [ ] **Do this before the Phase 1 config model hardens** — retrofitting it later is exactly the
      rebuild CLAUDE.md warns against.

### P1.4 — Notifications
- [ ] In-app + **email digest** ("3 prospects à relancer aujourd'hui").

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

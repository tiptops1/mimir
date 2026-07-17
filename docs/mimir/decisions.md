# Mimir — decisions log

> Companion to `roadmap.md` and `AGENTIC-PLATFORM-DECISION-MEMO.md`. One entry per closed decision,
> newest last. When this file and the memo disagree, this file wins (it's more recent by
> construction).

## 2026-07-15 — S0: environment split executed (D6 mechanics)

**Duplication mechanic: full-history `git clone` of the baseline repo @ `719f842`, origin swapped
to `tiptops1/mimir`.**

Why clone over squash/fresh-init:
- Shared git history keeps `git cherry-pick <sha>` the tool for pulling Vision RM bug fixes across
  (§0.5 baseline discipline explicitly plans for this). A squashed baseline would demote fix-porting
  to manual patch application.
- The baseline must be a *faithful* copy of the working system (control/tenant Prisma split, DB
  router, AES-256-GCM encryption, jose auth) — clone guarantees byte-fidelity at the chosen commit.

Accepted caveat, recorded consciously **at the time this was a private repo**: the inherited history
contains the baseline owner's prospect CSVs (`data/crm-chris-*.csv`, deleted from the working tree
in the first Mimir commit) and a committed 21 MB Prisma query-engine DLL under
`src/generated/control/`. Both remain reachable in git history. **⚠ Superseded 2026-07-15: this repo
is now public (discovered during S1's push).** The original "acceptable because private" rationale no
longer holds — the CSVs are real client prospect data. Needs `git filter-repo` to purge them from
history, or the repo needs to go back to private, before this is actually resolved.

**Infrastructure isolation (D6):** own Atlas project/cluster (M0 `mimir-dev`, EU region), own
Vercel project, own cron-job.org schedules, fresh `ENCRYPTION_KEY` / `SESSION_SECRET` /
`CRON_SECRET`. Nothing in this environment can reach the `crm-railway` prod cluster — `.env` never
contains its host; the `mimir-env-guard` skill enforces the check before every script/db:push.

**M0 tier note:** free tier is fine for S0–S11. The 3-search-index cap on M0 becomes the binding
constraint at **S12** (per-tenant vector indexes) — plan the Flex/M10 upgrade there, not before.

## 2026-07-15 — Mimir is a permanent parallel platform (§0.5 open decision, closed)

**Decision: permanent parallel platform, not a proving ground that merges back.**

Consequences, so nobody re-litigates them implicitly:
- Drift between the two codebases is accepted. Vision RM bug fixes still get cherry-picked across
  when relevant (own small session, explicit diff — token rule 7), but there is no obligation to
  keep the baseline in sync.
- Roadmap bug-rule 7's merge-back rationale ("additive-only keeps merge-back cheap") is void.
  **Additive-only schema stays anyway** — as discipline, and because it keeps cherry-picks clean.
- The inherited Vision RM feature surface (CRM, outreach, Lead One, Finances) is Mimir's substrate,
  not a product Mimir maintains for the baseline's users. The baseline's original customer stays on
  the baseline repo.

## 2026-07-15 — S1: docs refactor executed

Ran the docs-drift item `strip-list.md` deferred to S1. `docs/roadmap.md` and
`docs/product-roadmap.md` — the baseline product's own 400+ line dated working logs, full of
customer-identifying detail baked into hundreds of entries — were **deleted** rather than scrubbed
(same acceptance rationale as the S0 clone caveat: still reachable via git history — though see the
public-repo caveat now attached to that rationale, above).
`docs/VISION-RM-BRIEF.md` was **renamed to `docs/CRM-BASELINE-BRIEF.md`** and genericized in place
(tenant-slug/domain examples, customer-name/product-branding framing removed) — it keeps its role as
the baseline architecture reference, just describing the CRM/Lead One/Outreach structure generically
instead of the specific customer it was built for. `CLAUDE.md` fully rewritten for Mimir (points at
`docs/mimir/*`, drops the old "don't break the live app" framing for "never point this repo at the
prod cluster"). `README.md`, `INTEGRATIONS.md`, `docs/architecture.md` genericized; while in there,
also fixed factual drift the S0b code strip left behind — these docs still referenced `npm run
seed`, `npm run sync:email/calendar/all`, `npm run clean:inbox`, IMAP setup steps, and Railway cron
instructions, all of which no longer exist in the codebase (S0b deleted the scripts and legacy
fallback paths). Corrected to the current tenant-provisioning + OAuth-only + Vercel/cron-job.org
reality. This entry and the S0/S0b entries below were subsequently edited to drop the remaining
customer-name references once it was discovered mid-session that this repo is public — see the
superseded-caveat note under S0.

**Not done here (flagged as a follow-up, not a doc issue):** `grep`-ing `src/` turned up the
baseline customer's business name hardcoded into AI prompt templates (`src/lib/ai-extract.ts:59`,
`src/lib/email-research.ts:223,230`) and a user-agent string (`src/lib/enrich.ts:349`) — a real
"config not code" violation, since every tenant's AI-drafted email would currently sign off with
that name regardless of tenant. Needs its own small session against `default-config.ts`/tenant
config, not bundled into a docs pass.

## 2026-07-15 — S0b: baseline strip-down executed

Ran the `docs/mimir/strip-list.md` punch list end to end. Runtime: the tenant-#1 IMAP/ICS/
`FIREFLIES_API_KEY` fallback branches in `tenant-cron.ts` and both `/api/cron` routes are gone —
email/calendar sync now runs only when a tenant has connected Google OAuth; Fireflies only via the
per-tenant `Integration` key. Deleted `imap-sync.ts` and `resolveTenant1Google()`; trimmed
`calendar-sync.ts` down to its shared `processCalendar` matching engine (still used by the OAuth
path) and dropped the legacy ICS-fetch function. Deleted five CLI scripts that only existed to
drive the retired path (`sync-email/calendar/all/fireflies.ts`, `clean-inbox-spam.ts`) + their
`package.json` aliases. The baseline owner's hardcoded single-tenant config constant was renamed to
`DEFAULT_CONFIG`; the dead CSV `prisma/seed.ts` and `bootstrap-control-plane.ts` are gone;
`add-user.ts` and the outreach unsubscribe test script now default to `crm_demo`. Real
customer-domain addresses in test fixtures and one UI example string are now `example.com`/generic.
`.env.example` lost `TENANT1_SLUG`, the legacy IMAP/ICS/`FIREFLIES_API_KEY` blocks, and the commented
`SEED_ADMIN_*` block. The repo-hygiene and `GOOGLE_CSE_*`/`TENANT` strip-list items were already
non-issues (verified, not tracked in git / not present in code). Docs drift is untouched —
explicitly S1. `npm run lint` + `npm run build` green; `grep -ri crm-railway` and a grep for the
baseline's real customer domains repo-wide now only hit docs (S1 scope).

## 2026-07-15 — S2: event schema + core data model designed (no code)

Design doc: `docs/mimir/events.md` — the reviewed artifact S3 implements verbatim. Decisions
closed there, recorded here so they don't get re-litigated at implementation time:

- **Taxonomy is the triple module × category × action**, stored as three indexed string columns
  on `AgentEvent`. The dotted `module.category.action` form is for docs/logs only — never a
  parsed single column.
- **Strings, not Prisma enums**, for every status/type/vocabulary field — matches the repo-wide
  baseline convention and keeps vocabularies additive without schema changes.
- **All four models live in the tenant schema** (through the DB router). Control plane gets
  nothing at S2; cross-tenant metering aggregation is S5's problem.
- **Ledger row = current state; events = history.** Every `AgentAction` transition emits exactly
  one `AgentEvent` from the same write API (S7), so they can't drift. Events are append-only;
  GDPR erasure scrubs `data`/`entityId` but keeps rows.
- **`AutonomyConfig` is one row per category** (not an `OutreachConfig`-style singleton) —
  categories graduate independently. Kill-switch is the inherited `paused/pausedReason/pausedAt`
  triple.
- **Never-graduates is defense in depth:** `maxLevel: 1` in seed config for money/legal, *plus*
  a hardcoded state-machine floor for health-flagged content — deliberately code, not config,
  so no tenant misconfiguration can lift it.
- **`autonomyLevelAtProposal` is stamped on every action** so graduation stats stay
  interpretable after a category's level changes; only level-1 (human-reviewed) actions count
  toward graduating.
- **Prompt versions are immutable once used** — editing inserts version n+1; actions pin
  `promptKey`+`promptVersion`. Templates declare a `taskClass`, never a model name — the S5
  router owns class → model.
- **FAILED is terminal**; a retry is a new proposal with a fresh event trail — no status rewinds.

## 2026-07-16 — S4: job queue = Inngest (memo §5.1 open decision, closed)

**Decision: Inngest** (`inngest` ^4.13, free "Hobby" tier: 50k executions/mo, where one
execution = a run or a step — a 3-step job ≈ 4). Evaluated against the roadmap's criteria
(Vercel 60s fit · resumable steps · per-step retries · cost · cron-job.org-style triggers):

- **Trigger.dev** — eliminated structurally: task code executes on *their* managed infra, so the
  DB router, encrypted connection strings and env would live in a second deployment target.
- **Upstash QStash (raw)** — cheapest, but it's a message queue, not an orchestrator: resume,
  per-step retry and idempotency would be hand-built — exactly the layer S7+ must be able to trust.
- **Vercel Workflows** — not in the memo's shortlist (GA'd 2026-04, after the memo). Credible
  runner-up: no new vendor, native. Rejected for now: 3 months GA, needs the still-deferred Vercel
  project for real observability, couples orchestration to the host. **Named re-evaluation
  candidate** if Inngest's $99/mo Pro cliff is ever approached.
- Inngest wins on: per-step retries with memoized earlier steps (default 4, configurable),
  best-in-class local dev server (`npx inngest-cli dev` — per-step timeline, replay), and
  `step.sleep`/`step.waitForEvent`, which map onto Heimdallr approval-wait shapes later.

**Standing rule (any provider): queue/event payloads carry IDs only** (tenantId + entity ids),
never domain content. Every step reads/writes domain state through the DB router — session-less,
so via control-plane lookup → `getTenantPrisma(decrypt(connectionString))`, never `getTenantDb()`.
Consequence: Inngest's cloud stores run metadata only, no tenant personal data. Inngest still
joins the sub-processor list (memo §5.4) for that metadata.

**Run model (closes the `events.md` S4 deferral):** no `Run` collection. `AgentEvent.runId`
stores the Inngest run ID; the Inngest dashboard/dev server is the run browser; our events
(`system.queue.run_started/run_finished/run_failed`) are the durable audit trail. Additive if a
Run model is ever needed.

**Proof route** (merged behind the `jobsEnabled()` env gate — `INNGEST_SIGNING_KEY` or
`INNGEST_DEV=1`, the `aiEnabled()` idiom): `POST /api/jobs/proof` → event
`system/proof.requested` → 3-step function `system-proof-run` (`src/lib/jobs/proof.ts`), served
at `/api/inngest`. Verified 2026-07-16 against `crm_demo` on the local dev server: with
`?failOnce=1` step 2 failed once and was retried alone (one `run_started`, one `run_finished`
with `attempts: 2, survivedFailure: true`); with `?failAlways=1` the `onFailure` handler wrote
`run_failed`. Inngest v4 API note: triggers live in `createFunction`'s first argument
(`triggers: [{ event }]`) — the three-argument v3 form from older docs throws at module load.

## 2026-07-16 — S5: AI metering + model router

`lib/ai/meter.ts` + `lib/ai/router.ts`, two new tenant-schema models (`AiUsage`, `AiBudget`).
Decisions closed here:

- **Metering lives in the tenant schema, not the control plane** — same shape as `LeadOneQuota`
  (per-tenant DB, through the router), matching the S2 note that cross-tenant aggregation is
  S5's problem, not a control-plane schema concern. The rollup is `scripts/ai/usage-report.ts`:
  loops ACTIVE tenants via the control plane, connects each tenant DB, sums.
- **One source of truth for spend.** `AiUsage` is a per-`(day, provider, model, taskClass)`
  ledger updated via atomic Mongo `$inc` (safe under concurrent serverless writers — unlike
  `LeadOneQuota`'s read-then-update, which is fine there only because Lead One is single-writer
  by design). `AiBudget` holds only the configured `monthlyLimitUsd`; month-to-date spend is
  computed by summing `AiUsage`, not tracked as a second counter, so the two numbers can't drift
  apart.
- **Budget gate is pre-call, not a reservation.** Cost isn't known until the response arrives
  (unlike Lead One's fixed per-call quota), so `checkBudget` gates on spend-so-far vs. limit; a
  call already in flight when the limit is crossed can push spend slightly over. Accepted
  trade-off, same spirit as `LeadOneQuota.takeQuota`'s "reserve n" but for a number that can't be
  known upfront — documented in `meter.ts`.
- **Pricing snapshot 2026-07 from the memo** (Haiku 4.5 $1/$5, Sonnet $3/$15, Opus 4.8 $5/$25,
  per MTok) — re-verify at https://docs.claude.com before this feeds real billing. Gemini 2.5
  Flash is priced at $0: the CRM-enrichment path only runs on Gemini's free tier, so it is
  genuinely free to us; tokens/calls are still recorded for visibility.
- **`extract`'s existing Gemini-preferred/Claude-fallback selection stays outside the static
  `TASK_CLASS_MODEL` table** — `ai-extract.ts`'s `provider()` picks Gemini-then-Claude exactly as
  before S5 and passes that choice down as an explicit override to `callByTaskClass`. The static
  table (`classify`/`summarize` → Haiku, `draft`/`extract`-by-default → Sonnet/Gemini) is for
  modules that don't exist yet (Huginn/Muninn/Bragi, S14+) and have no hardcoded selection of
  their own. This is what "inherited enrichment migrated onto the router unchanged in behavior"
  means in practice: same prompts, same provider fallback, same retry — now metered.
- **Low-level HTTP callers moved from `ai-extract.ts` into `router.ts`** (`callGemini`/
  `callClaude`) so real token usage from each API's `usage` field can be captured at the call
  site — the pre-S5 code discarded it. `callModel`/`extractInsight`/`composeProspectingEmail` now
  take a `PrismaClient` (already available at every call site) so the metering write can happen.
- **`scripts/test-ai-insight.ts` now needs a tenant slug** (`crm_demo` default) instead of being
  DB-free — metering means every AI call writes an `AiUsage` row, so a "no DB touched" probe is no
  longer possible.

## 2026-07-17 — Phase 0 checkpoint: platform-vision alignment review

Full review of the memo/roadmap against the owner's stated end-state: a fully agentic platform
piloting *every* business area of a company (sales, pipeline gen, finance, marketing, outreach,
legal, HR, tech support, customer success, product knowledge, RAG), with a hierarchical agent
org (CEO → Directors → Managers → Employees) issuing top-down directives, plug-and-play
onboarding, and an immersive connected UI. Verdict: the vision is the platform's end-state, not
a different platform — the memo planned the first seven realms of it. Four decisions closed:

1. **Odin — orchestration layer, approved as Phase 5.** A top-level agent sets objectives and
   cascades directives down to module agents. Directives are tenant config; **every decision at
   every level of the hierarchy still flows through the Heimdallr ledger** — the hierarchy sets
   *objectives*, per-category `AutonomyConfig` governs *execution rights*. D2 (graduated
   autonomy, circuit breaker, never-graduates list) stays fully intact underneath it. Gets its
   own Opus plan-mode design session (S20) before any code; not pulled earlier because it needs
   real module agents to direct.
2. **Three new realms committed, in priority order: Customer Success → Legal → HR** (Phase 6).
   CS first (health scoring, renewals, churn signals — closest to existing data). Legal = growing
   Forseti from compliance UI into a draft-and-approve legal agent (never-graduates rule holds
   forever there). HR last (least defined, least urgent for the broker vertical).
3. **ETL/onboarding module pulled forward into Phase 2**, built alongside Mímisbrunnr ingestion
   (S13b) since it reuses the same chunk/quarantine pipeline and Inngest queue. Scope: source
   connectors → mapping wizard onto the config-driven schema → dedupe → health-classifier
   quarantine → idempotent, audited import runs. Accepted costs, recorded consciously: Huginn
   slips one session, and with no real customer to migrate yet it's tested against synthetic
   exports only.
4. **Cosmos amendment — subtle ambient motion layer sanctioned.** The "nothing loops" law gets
   one narrow exception: a barely-perceptible ambient drift (starfield/aura) in the realm
   atmosphere layer only — never behind text-dense surfaces, transform/opacity only, fully
   disabled under `prefers-reduced-motion`. Full dynamic backgrounds rejected (readability,
   battery, reads as flashy not premium). `mimir-cosmos` skill amended.

Also closed: **the business pilot dashboard ("whole company at a glance") + token-usage UI are
Nornir's hero surface** — S17's scope now says so explicitly (the S5 `AiUsage`/`AiBudget` data
already exists; it only has a CLI report today). And the customer-side onboarding requirements
(OAuth grant, G2 data inventory, designated approver, DPA, exports for ETL, autonomy ramp
policy) need a real onboarding doc before customer #1 — attached to the ETL session's exit.

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

## 2026-07-17 — Checkpoint: Phase 1 (Heimdallr) wrap

Demoed the full loop on `crm_demo` with hand-inserted `AgentAction` rows (reusing S8's
`scripts/heimdallr/seed-demo-proposal.ts`): propose → approve (verified in DB), edit-then-approve
(`wasEdited: true`, `editedPayload` persisted, `decidedBy` recorded), reject (already proven at
S8), execute → undo. All scratch data reverted after; `crm_demo`'s inbox is back to 0 pending.

**Real gap found, not a bug: nothing calls `executeAction` today.** `approveActionSA` only
transitions PROPOSED → APPROVED. No module exists yet to actually apply the domain change and call
`executeAction(..., { undoData })` — that's expected (Huginn/Bragi/etc. don't exist until Phase
2+), but it means the "approve → execute" half of the loop has never run end-to-end except via a
throwaway demo script (`executeAction` called manually, deleted after). **Action for whichever
module writes the first real proposal:** each module's own execution path is responsible for
calling `executeAction` after approval — the ledger does not do this automatically, and nothing
currently sweeps APPROVED rows to execute them.

**Real gap found, more load-bearing: `undoAction` never reverts domain data.** Verified directly —
after undo, the `Company.notes` field written by the demo's "execution" step was still mutated;
`undoAction` (`src/lib/heimdallr/ledger.ts`) only flips ledger state (EXECUTED → UNDONE) and writes
the `undone` `AgentEvent`. `undoData` is stored on the row but nothing reads it back. **This must be
fixed or explicitly designed around before any module ships an undoable action** — right now
"annuler" in the inbox UI gives the human the impression the change was reverted when it wasn't.
Two ways to close this before Phase 3 (Huginn is the first module whose actions will realistically
be undone by a human): (a) give `undoAction` an optional module-supplied revert callback/adapter
keyed on `category` or `type`, invoked inside the same transaction; or (b) keep `undoAction` as
pure ledger bookkeeping and require every module's execution path to also register a matching undo
handler that the inbox action calls first. Not decided here — flag for whoever designs Huginn's
draft-reply execution path (S14), since that's the first real reversible action.

**Breaker/graduation design (S9) not re-verified this session** — S9's own exit criteria already
demonstrated the level 2→1 demotion and inbox banner end-to-end; no new information since then to
suggest it needs adjusting.

**Inbox UX**: no gaps found worth a follow-up session. Details/payload/sources/trigger rendering,
filters, and the undo tray all read correctly against real (if synthetic) data.

**Verdict: Heimdallr's ledger/approval/undo-bookkeeping loop is solid. The execute-and-undo
*domain-effect* wiring is the one open thread Mímisbrunnr/Huginn must not silently inherit as
"already solved."** Recorded here rather than silently rolling into Phase 2.

## 2026-07-17 — S10: embedding provider = Gemini (`gemini-embedding-001`, dims=768)

**Decision: Gemini `gemini-embedding-001` at `outputDimensionality: 768`, not Voyage.**

Ran `scripts/rag/embedding-spike.ts` (kept in the repo — cheap to re-run if this needs
revisiting) against `scripts/rag/spike-data.ts`: 50 synthetic French courtier/insurance chunks
across 10 topics (auto, habitation, santé, RC pro, assurance vie, procédure sinistre,
résiliation/Loi Hamon, cotisations, garanties complémentaires, relation client), 20 labeled
eval queries (`query → expected chunk id`), recall@1/@3 scored by cosine similarity. Compared
`gemini-embedding-001` (768 dims, Matryoshka-truncated from a 3072 default) against `voyage-4`
(1024 dims, Voyage's current general-purpose/multilingual model — not the older `voyage-3` the
roadmap named, since Voyage's lineup moved on and `voyage-4` is also the one with a real free
tier). Pricing/API shapes verified live against `ai.google.dev`/`docs.voyageai.com` on
2026-07-17, not from training-data memory (S5's stated discipline).

**Results:** Gemini 100% recall@1, 100% recall@3. Voyage 95% recall@1 (1 miss — confused two
adjacent auto-coverage-type chunks, "tous risques" vs "au tiers"), 100% recall@3. Both
effectively free at this scale (Gemini: ~3.3k tokens ≈ $0.0005 at paid-tier pricing, well
inside its free tier; Voyage: `voyage-4` ships 200M free tokens/account). Latency comparable
(~1.4s for 50 chunks, both providers, single batch call).

**Why Gemini despite near-parity:**
- **No new vendor.** Gemini is already wired in (`ai-extract.ts`, `lib/ai/router.ts`,
  `GEMINI_API_KEY`) and already on the sub-processor list. Voyage would be a new data
  processor — real weight while **G2 (HDS/health-data scope) is still open** and Huginn hasn't
  ingested anything yet; minimizing new processors before that gate closes is the safer default,
  not a marginal convenience.
- **Flexible output dimensionality is the direct answer to the S12 constraint.** `decisions.md`
  (S0 entry) already flags the M0 cluster's 3-search-index cap as binding at S12. Gemini's
  128–3072 Matryoshka range means the dimension can be tuned to index-cost budget without a
  provider or architecture change; Voyage's dims are fixed per model.
- **Voyage's real advantages didn't apply here.** `input_type` query/document asymmetric
  prompting and domain-specialized models (`voyage-law-2`, 16k context) are aimed at
  legal/contract-heavy corpora — not this phase's generic broker-document shape. **Flag
  `voyage-law-2` as the first thing to re-evaluate if/when Legal (Phase 6, S23) needs its own
  retrieval index** — that's the corpus it's actually built for.
- Recall difference (100% vs 95%, n=20) isn't strong evidence on its own — noted, not leaned on.

**Not resolved here, flag before S11 ingests at real scale:** free-tier RPM/TPM for
`gemini-embedding-001` couldn't be confirmed from public docs (Google points to the AI Studio
dashboard, account-specific). S11's ingestion pipeline should check actual quota headroom
before assuming batch-ingestion throughput, not carry this spike's single-batch-call result
forward as a scale proof.

## 2026-07-17 — S11: quarantine posture = hash + verdict only, rawText scrubbed

**Decision: D3 exclusion enforcement via data minimization in the ingestion pipeline itself,
not in governance/policy alone.**

Health data flagged by the Haiku classifier is quarantined as SHA256(content) + verdict (categories,
confidence, reason) only — the original text is never persisted, neither in documents nor in any
audit trail. Raw document text (`rawText`) is set to null at the end of processing
(after classification but before storage). This is the "plan as if HDS applies" posture from D3
while G2 (health-data scope) is still open: the data architecture itself proves no health
information survives ingestion, regardless of later policy changes.

**Fail-closed classifier posture:** Every chunk whose verdict is missing or unparseable (LLM failure,
budget exhausted, or malformed JSON) is treated as flagged, never stored. This is fail-safe, not
fail-soft — it enforces D3 by construction: unverified content never reaches the knowledge base.

**Gemini embedding quota flag resolved:** S11 ran real ingestion E2E and confirmed quota headroom is
present in the free tier (no throttling on ~3-4 documents / request batch). Quota is still undocumented
by Google (account-specific in AI Studio), so S11 logs embedding calls via `lib/ai/meter.ts` for
ongoing visibility if real-scale ingestion later requires a paid tier upgrade.

**Not resolved here, for S12:** Vector index provisioning, retrieval, and the M0 cluster's 3-search-index cap.

Commit 269673b.

## 2026-07-17 — S12: index budget is cluster-wide (control plane), M0 cap now fully spent

**Decision: the search-index budget counter lives in the control plane (`SearchIndexBudget`
singleton), not a per-tenant collection.** Atlas's search-index cap is per-cluster, not per
tenant DB — `AiBudget`/`LeadOneQuota`'s per-tenant shape (S5/inherited baseline) would leave each
tenant blind to what other tenants on the same cluster have already spent. Confirmed the real
number in-repo: `scripts/create-search-indexes.ts`'s own comment says **M0 allows 3 search
indexes**, not the memo's 2,500/cluster figure (that number is presumably a paid-tier count or a
different limit — memo is stale here, this file wins per the header rule).

**Consequence, not hypothetical:** 2 of 3 were already spent by the inherited `Company`/`Contact`
text-search indexes before S12 wrote a line of code. Provisioning `crm_demo`'s
`KnowledgeChunk` vector index spent the 3rd. **`mimir-dev` is now at the M0 cap (3/3).**
Onboarding a second tenant with a knowledge base is blocked until the cluster is upgraded to
Flex/M10 — a billing action Nicolas does himself in the Atlas console, not something this repo's
scripts do automatically. `checkAndReserveIndexSlot` (`src/lib/rag/index-budget.ts`) hard-blocks
at the cap (`IndexBudgetExceededError`) rather than silently skipping, so this surfaces loudly at
the next `tenant:provision` run rather than being rediscovered as a mystery failure at S13/onboarding.

Commit — see S12 entry, `docs/mimir/roadmap.md`.

## 2026-07-17 — S13b: import commits are human actions (no Heimdallr ledger), quarantine at field granularity

**Decision: the onboarding import does NOT route through the Heimdallr ledger.** An import the
admin explicitly commits from the wizard (`/settings/import`) is a human action — the same class
as every existing server action — not an autonomous agent proposal. D5's "one bridge" governs
agent side effects; wrapping a human bulk import in PROPOSED→APPROVED would be ceremony with no
autonomy semantics. Audit instead = `AuditLog` `IMPORT_COMMIT` at the action boundary + the
`AgentEvent` stream from the job (`run_started`/`quarantined`/`imported`/`run_finished`/
`run_failed`, `module: system`, `category: import`), mirroring how the S11 ingest job audits itself.

**Decision: import-time health quarantine strips fields, not rows.** A CRM migration row whose
free-text note is health-flagged is still imported — minus every mapped free-text field — with
`ImportRecord.status = QUARANTINED_FIELDS` and a `QuarantineItem` (docId = run id, seq = row
index, hash + verdict only). Blocking the whole company row on one note would break migrations;
D3 only forbids persisting the flagged *text*. Same fail-closed posture as ingest: classifier
unavailable → the batch throws → run FAILED, nothing written. The D3 window (`ImportRun.rawText`,
`ImportRecord.raw` holding pre-classification text) is closed by scrubbing rawText at parse and
all record payloads at finalize — verified null in E2E.

**Idempotency keys:** file `sha256` at run level (re-upload → same run), SIRET-or-deterministic
placeholder (`IMPORT-<sha256(normalizedName|codePostal)[:12]>`) as the company upsert key at row
level. Re-commit of a DONE run converged to zero new writes in E2E (import_demo tenant, 13-row
synthetic fixture: 10 created / 2 skipped / 1 error / 1 quarantined).

**Accepted: tested against synthetic exports only** — no real customer export exists yet; the
mapping synonym table and coercers will need a revision pass at the first real onboarding
(flagged in `docs/mimir/onboarding.md`, itself a draft for the same reason).

**Operational note:** `tenant:provision` gained `--no-vector-index` — the M0 cap being 3/3 (see
S12 entry) would otherwise hard-block provisioning any new tenant; demo/import tenants without a
knowledge base skip the slot instead. `import_demo` was provisioned this way.

# Mimir — dev roadmap, Claude Code session plan

> Companion to `AGENTIC-PLATFORM-DECISION-MEMO.md`. This is the execution plan: one checkbox ≈ one
> Claude Code session. Tick as you go — this file is **Mimir's** cross-session memory, in the same
> spirit as the earlier CRM baseline roadmaps. Lives at `docs/mimir/roadmap.md` **in the Mimir repo**.
>
> Ritual per session (unchanged from the brief): **plan mode → approve → execute → lint → build →
> commit → update this file → `/clear`.** Push to `main` only on an explicit "push".
>
> **Revised 2026-07-15 — D6: separate environment.** Mimir is no longer built inside the baseline
> repo. It gets its **own repo, own Atlas cluster, own Vercel project, own cron schedules, own
> secrets**, seeded from a duplicate of the CRM baseline at its current commit. See §0.5 and
> S0. Everything below assumes that split.

---

## 0. Model strategy

### Build-time (Claude Code, on the Pro/Max subscription)

| Session type | Model | Why |
|---|---|---|
| Architecture / schema / event design / spikes-that-decide / **the env split (S0)** | **Opus** (Fable/Mythos-tier if your plan has it) | Design mistakes are the expensive bugs. One strong plan-mode pass is cheaper than three Sonnet rewrites. |
| Implementation against an approved plan | **Sonnet** | Best throughput per token for code volume. This is ~70% of sessions. |
| Mechanical work — doc updates, seed scripts, lint sweeps, renames | **Sonnet** (or Haiku if you're rationing) | Don't spend Opus on chores. |

Practical pattern: run **plan mode on the stronger model**, then switch to Sonnet (`/model`) for
execution in the same session. If a Sonnet session starts thrashing (repeated failed edits, circular
debugging), stop, `/clear`, and re-plan on Opus — thrash burns more tokens than the upgrade.

### Runtime (API-billed, never Pro — memo §1)

| Task | Model |
|---|---|
| CRM enrichment (inherited from the baseline) | Gemini 2.5 Flash — unchanged |
| Health classifier, event classification, extraction | **Haiku** |
| Customer-facing drafts (Huginn, Bragi), RCA docs (Muninn) | **Sonnet** |
| All cron/batch agent work | Batch API + prompt caching, always |

Verify current model strings and pricing at https://docs.claude.com before wiring the router —
the memo's rate snapshot is dated 2026-07 and explicitly says verify before quoting.

---

## 0.5 Environment model — read this before anything else

Two independent environments from now on:

| | **CRM baseline (prod)** | **Mimir (new)** |
|---|---|---|
| Repo | the baseline repo | new repo, seeded from the baseline repo @ `719f842` |
| Atlas | `crm-railway` cluster (legacy name), prod data | **new project/cluster**, no prod data, ever |
| Host | existing Vercel project | **new Vercel project** |
| Crons | cron-job.org, 4 routes ✅ verified scheduled | **new schedules, new `CRON_SECRET`** |
| Secrets | existing `.env` | **all fresh** — never reuse `ENCRYPTION_KEY`, `SESSION_SECRET`, `CRON_SECRET` |
| Live user | the baseline's original tenant | none — demo tenants only |

**What this buys:** a real staging environment for the first time. The brief's standing constraint
("local `.env` points at prod Atlas — every script run is production") **no longer applies in the
Mimir repo**. It still applies in the baseline repo.

**What this costs — accept it consciously:** the D4/D5 reuse story now means *inheriting a copy* of
`/inbox`, `AuditLog`, the outreach ledger and the DB router, not extending the live ones. The two
codebases will drift.

**Open decision — record in `decisions.md` at S0:** is Mimir a *permanent parallel platform*, or a
proving ground whose modules get **merged back** into the baseline repo once validated? This
changes how hard you work to keep the baseline in sync. Don't leave it implicit.

**Baseline discipline (new standing rules):**
- The duplicated baseline code is a **baseline, not a fork to improve**. Bug fixes that belong to
  the baseline product go in the baseline repo and get pulled across — not fixed only in Mimir.
- Anything gated to tenant #1 in the baseline (legacy IMAP/ICS/`FIREFLIES_API_KEY` fallbacks,
  `TENANT1_SLUG` assumptions, hardcoded single-tenant seed config) is **dead weight on day one** —
  identify it at S0, strip or neutralize it before building on top.
- The Mimir repo has **no production user**. "Don't break the live app" is replaced by "never point
  this repo at the prod cluster."

---

## 1. Pre-flight

**Human/business track (runs in parallel, not Claude Code work):**
- [ ] **G1** — start Google OAuth Production + CASA process now. Longest external lead time.
      *Note: the Mimir environment needs its own OAuth client too — G1 work should account for it.*
      *Not a blocker for S14: a Testing-mode client (own client ID, test users added manually,
      per `INTEGRATIONS.md` §1) fully exercises the draft pipeline. CASA only required before a
      real, unaffiliated tenant goes live (Testing mode caps at 100 test users, tokens expire ~7d).*
- [x] **G2** — ~~ask the baseline's business contact what a typical month of client email contains →
      close the HDS decision~~ **before Huginn ingests anything**. **Closed 2026-07-18 by a modeled
      corpus** (no real client yet): assumed vertical = multi-line FR brokerage; 42-email labeled
      inbox (`scripts/huginn/sample-inbox.ts`) measured against the S11 classifier
      (`scripts/huginn/g2-evidence.ts --live`) → 14% health, classifier recall 100% / precision 86%.
      Decision: keep D3 exclusion, stay on Atlas+Vercel (no HDS), pure-santé tenants need a separate
      certified env. See `decisions.md` 2026-07-18. Re-run the inventory at the first real onboarding.
- [x] ~~Record the prod Vercel URL~~ — done.
- [x] ~~Verify all four cron routes are scheduled on cron-job.org~~ — **verified 2026-07-15, all
      four successful.**
- [x] Record the **new** Mimir Vercel URL + Atlas cluster name once S0 lands (same trap, new env).
      *S0 done 2026-07-15: Atlas = `mimir-dev` cluster (EU M0 free). Vercel + cron-job.org setup deferred to later (not blocking development).*

**Accounts/infra ready before S0:** Atlas org access (to create a new project), Vercel account (new
project), GitHub (new repo).

---

## 2. Session plan

Sizing: **S** = comfortably one session · **M** = one full session · split anything that grows past M.

**Checkpoint** sessions (new) close every phase: no code by default, XS. Demo what the phase
actually shipped, compare it against the memo's intent, and decide out loud whether anything built
so far suggests a new feature, a scope cut, or a re-prioritization of what's next. Log anything
that changes the plan in `decisions.md`; edit the session list below if scope actually changes.
Skipping a checkpoint is fine if the phase was trivial — don't force it — but don't silently roll
into the next phase on autopilot either.

### Phase −1 — Environment split (new, blocks everything)

- [x] **S0 — New repo + environment, CRM baseline duplicated** · **Opus, plan mode** · M · ✅ 2026-07-15
  Run **outside** the baseline repo (it creates a sibling repo). Do not touch the baseline repo
  in this session.
  Scope: decide the duplication mechanic (clone/fork vs. copy-source) and record why; create the new
  repo seeded from the baseline repo @ current commit; new Atlas project/cluster; new Vercel
  project; fresh `ENCRYPTION_KEY` / `SESSION_SECRET` / `CRON_SECRET`; `.env` pointed at the **new**
  cluster; identify and flag every tenant-#1-specific / prod-specific artifact that shouldn't carry
  over; bootstrap one demo tenant so the baseline provably runs.
  *Exit:* new repo builds + runs against the new cluster, one demo tenant logs in, prod untouched,
  the permanent-parallel-vs-merge-back decision written to `docs/mimir/decisions.md`, and the manual
  Atlas/Vercel steps you must do by hand listed out.

- [x] **S0b — Baseline strip-down** · Sonnet · S · ✅ 2026-07-15
  Execute the strip list S0 produced: remove/neutralize legacy tenant-#1 fallbacks, hardcoded
  single-tenant seed config, dead env vars. Keep the spine (control plane, router, auth,
  config-driven schema).
  *Exit:* lint/build green on the new repo; `grep` for the prod cluster host returns nothing.

### Phase 0 — Groundwork (no gates block this)

- [x] **S1 — Docs + CLAUDE.md refactor** · Sonnet · S · ✅ 2026-07-15
  `CLAUDE.md` rewritten for this repo (Mimir identity, pointers to `docs/mimir/*`, the standing
  rules, `mimir-ship`/`mimir-env-guard` ritual, no baseline-only content). `docs/roadmap.md` +
  `docs/product-roadmap.md` (the baseline's own dated build logs) deleted — not Mimir's history.
  `docs/VISION-RM-BRIEF.md` renamed to `docs/CRM-BASELINE-BRIEF.md` and genericized in place
  (tenant-slug/domain examples, dead script references removed) as the baseline architecture
  reference. `README.md`/`INTEGRATIONS.md`/`docs/architecture.md` genericized + corrected for
  drift the S0b code strip left behind (dead `npm run seed`/`sync:*` script references, stale
  Railway/IMAP instructions). *Exit met:* a repo-wide search for the baseline customer's name/domain
  across the top-level docs returns nothing; CLAUDE.md ~50 lines.

- [x] **S2 — Event schema + core data model (design only)** · Opus, plan mode · M · ✅ 2026-07-15
  Design: `AgentEvent` taxonomy (module × category × action lifecycle), `AgentAction` ledger record
  (proposed → approved/edited/rejected → executed → undone, with source passages + trigger refs),
  `AutonomyConfig` (per-tenant × per-category level 0–3), `PromptTemplate` (config, not code).
  Generic ontology, French labels in config. Events can't be backfilled — this schema is the one
  thing worth over-thinking. *Exit met:* `docs/mimir/events.md` written (four Prisma model drafts,
  state-machine guard table, graduation-math inputs, seed category list with never-graduates
  flags, GDPR-erasure posture); design decisions logged in `decisions.md`. No code pushed —
  S3 implements the doc verbatim.

- [x] **S3 — Schema implementation + seed** · Sonnet · S · ✅ 2026-07-16
  Implemented S2's four models (`AgentEvent`, `AgentAction`, `AutonomyConfig`, `PromptTemplate`)
  verbatim in `prisma/tenant/schema.prisma`, `db:push`'d against `mimir-dev`. Extended
  `seedTenantConfig()` with the 7 seed autonomy categories (all `level: 0`, finance/legal capped
  at `maxLevel: 1`) and a 2-row `PromptTemplate` skeleton (`crm.ai_extract.system`,
  `outreach.email_draft.system`) mirroring the prompts already hardcoded in `ai-extract.ts` /
  `email-research.ts` — those modules are unchanged; wiring them onto `PromptTemplate` (and
  dropping the hardcoded broker name) is deferred to its own session. *Exit met:* lint/build
  green, seed verified idempotent (row counts unchanged across two runs).

- [x] **S4 — Job-queue spike + decision** · Opus for the eval, tiny code · M · ✅ 2026-07-16
  **Decision: Inngest** (see `decisions.md` 2026-07-16 — Trigger.dev/QStash rejected; Vercel
  Workflows, GA'd post-memo, is the named runner-up). Proof route shipped behind the
  `jobsEnabled()` env gate: `POST /api/jobs/proof` → 3-step `system-proof-run`
  (`src/lib/jobs/proof.ts`, served at `/api/inngest`) — verified on the local dev server: step 2
  failed once and was retried alone (`run_finished` with `survivedFailure: true`), permanent
  failure wrote `run_failed` via onFailure. Standing rule recorded: queue payloads carry IDs
  only, domain state in Mongo through the DB router. Run model closed: no Run collection,
  `AgentEvent.runId` = Inngest run ID.

- [x] **S5 — AI metering + model router** · Sonnet · M · ✅ 2026-07-16
  `lib/ai/meter.ts` on the `LeadOneQuota` pattern: per-tenant `AiUsage` ledger (atomic increment,
  keyed by day/provider/model/taskClass) + `AiBudget` monthly cap, pre-call gated. `lib/ai/router.ts`:
  `TASK_CLASS_MODEL` (classify/summarize → Haiku, draft → Sonnet, extract-by-default → Gemini) for
  modules that don't exist yet; `callByTaskClass` is the single metered entry point. `ai-extract.ts`'s
  existing Gemini-preferred/Claude-fallback selection passes an explicit override — unchanged
  behavior, now metered. Batch/caching for cron-shaped work deferred (no batch-shaped agent work
  exists yet outside the S4 proof route). *Exit met:* `enrichActivities`/`composeProspectingEmail`
  migrated onto the router with identical prompts/providers/retries; `scripts/ai/usage-report.ts`
  shows per-tenant month-to-date spend vs. budget across every ACTIVE tenant.

- [x] **S6 — Demo tenant + synthetic data** · Sonnet · S · ✅ 2026-07-16
  Fleshed out `crm_demo` with `scripts/seed-demo-data.ts` (`npm run tenant:seed-demo`): 20 French
  courtier companies funnel-shaped across all 8 seeded stages, contacts, deals (incl. historical
  renewal deals), activities (some with AI-insight fields), tasks, stage-change history, and 7
  finance-cockpit entries. Idempotent — Company upserted by siret, children deleted+recreated per
  run; verified identical counts across two runs. Lead One / outreach-message seeding deliberately
  out of scope (separate module story; would misrepresent the dormant-by-default outreach engine).
  *Exit met:* demo tenant realistic enough to demo against; documented in CLAUDE.md.

- [x] **Checkpoint — Phase 0 wrap** · reflection, no code · XS · ✅ 2026-07-17
  Ran as a full platform-vision alignment review against the owner's stated end-state (agentic
  platform for *every* business area, hierarchical agent org, plug-and-play onboarding,
  immersive UI). Four decisions closed — see `decisions.md` 2026-07-17: **Odin** orchestration
  layer approved as Phase 5; **Customer Success → Legal → HR** realms committed as Phase 6;
  **ETL/onboarding pulled into Phase 2** (S13b); cosmos **ambient-motion amendment** sanctioned.
  S17 (Nornir) rescoped around the business pilot dashboard + token-usage UI. Phase 1 scope
  (S7–S9) confirmed unchanged — the vision makes the ledger *more* load-bearing, not less.

### Phase 1 — Heimdallr, module 0 (the bridge)

- [x] **S7 — Ledger core + state machine** · plan on Opus, implement on Sonnet · M · ✅ 2026-07-17
  `src/lib/heimdallr/state-machine.ts`: pure guard logic (`assertTransition` against the
  events.md §2 table, `isAutoApproveEligible`, `isUndoable`, `isExpired`) — no I/O, fully
  unit-tested (65 tests, vitest). `src/lib/heimdallr/ledger.ts`: the write API — `proposeAction`,
  `approveAction` (edit-then-approve + auto-approve, `wasEdited` diff flag), `rejectAction`,
  `expireAction`/`sweepExpired`, `executeAction` (reversible actions must supply `undoData`),
  `failAction`, `undoAction`, `autoApproveIfEligible`. Every transition is one Prisma interactive
  `$transaction` (read → guard → update → paired `AgentEvent`) so ledger and event stream can't
  drift; every function takes the tenant `PrismaClient` first arg (meter.ts/guardrails.ts
  convention), no `getTenantDb()` import, stays callable from Inngest jobs. Zod-validated inputs.
  `vitest` added (`npm run test`); wired into the `mimir-ship` chain after lint, before build.
  *Exit met:* tests green; `npm run test` in the ship chain; `npm run lint`/`npm run build` clean.

- [x] **S8 — Approval inbox UI** · Sonnet · M · ✅ 2026-07-17
  New route `/heimdallr/inbox` (own page, not a fork of `/inbox` — different data shape,
  same reuse-the-pattern approach): `src/lib/heimdallr/queries.ts` (read-side companion to
  `ledger.ts`: `listPendingActions`/`countPendingActions`/`listUndoTrayActions`/
  `listAutonomyConfigs`), `src/app/actions/heimdallr.ts` (`approveActionSA`/
  `approveEditedActionSA`/`rejectActionSA`/`undoActionSA`, `verifySession()` → `decidedBy`),
  `heimdallr-action-row.tsx` (expandable payload/sources/trigger detail, edit-then-approve
  textarea), `heimdallr-inbox-filters.tsx` (category/module/text, `useUrlFilters`), an undo
  tray section gated on `isUndoable` (state-machine.ts, reused not re-derived). Sidebar:
  `/heimdallr/inbox` added to `NAV` under the `mimir` realm group (route already registered
  in `realms.ts`); fixed a latent bug this exposed — `GROUPS` matched `item.href.slice(1)`
  against `realm.routes`, which breaks for any nested route (only worked before because
  every existing href was a single segment); now uses `item.href.split("/")[1]`. Layout
  gained a `heimdallrPendingCount` badge (mirrors `pendingCount`). One-off demo script
  `scripts/heimdallr/seed-demo-proposal.ts` (`npx tsx`, not in the seed chain) calls
  `proposeAction()` against a real `crm_demo` company. *Exit met:* verified in-browser —
  seeded proposal renders category/module/payload/sources/trigger; Approuver, Modifier puis
  approuver, and Rejeter each tested end-to-end and the row leaves the pending list; dark
  theme confirmed via computed styles (abyss/bone tokens, no literal colors in the diff); no
  horizontal overflow at 375px; lint/build clean.

- [x] **S9 — Undo + circuit breaker** · Sonnet · S · ✅ 2026-07-17
  Undo window was already fully implemented at S7/S8 (`isUndoable`, `undoAction`, the inbox's
  "Actions annulables" tray) — nothing new needed there. Added the circuit breaker: `AutonomyConfig`
  gained `lastBreakerTrippedAt`/`lastBreakerReason` (additive); `state-machine.ts` gained
  `breakerDecision` (pure, generalizes `lib/outreach/guardrails.ts`'s `bounceBreakerReason` from a
  tenant-wide pause to a per-category demotion, evaluating edit-rate and an optional module-supplied
  negative-signal independently, each gated by its own `breakerMinSample`); `ledger.ts` gained
  `demoteCategory` (level → 1, writes paired `breaker_tripped` + `level_changed` `AgentEvent`s per
  events.md §3), `evaluateBreaker` (queries trailing `graduationWindowDays` edit-rate from
  `AgentAction.wasEdited`, calls the pure decision, demotes on trip), and `sweepBreachedCategories`
  (iterates level≥2 categories — exported like `sweepExpired`, not yet wired to a cron, since no
  Inngest cron infra exists for either sweep yet). Inbox gained a warning banner surfacing any
  category still sitting at its demoted level with a reason. No module produces a real
  negative-signal yet (Huginn doesn't exist until Phase 2) — the breaker runs on edit-rate alone
  today. *Exit met:* 8 new `breakerDecision` unit tests (73 total, all green); verified end-to-end
  against `crm_demo` — seeded edit-heavy `AgentAction` rows, ran `evaluateBreaker`, confirmed
  `AutonomyConfig.level` dropped 2→1 and the inbox rendered the "Disjoncteur déclenché" banner;
  scratch data cleaned up after; lint/build clean.

- [x] **Checkpoint — Phase 1 wrap** · reflection, no code · XS · ✅ 2026-07-17
  Demoed propose → approve / edit-then-approve / undo on `crm_demo` with hand-inserted
  `AgentAction` rows (reject already proven at S8); all scratch data reverted after, inbox back
  to 0 pending. Ledger/approval/undo-bookkeeping loop confirmed solid; inbox UX had no gaps
  worth a follow-up. **Two real gaps logged in `decisions.md` for Phase 2/3 to not silently
  inherit as solved:** (1) nothing calls `executeAction` yet — no module exists to apply a
  domain change and execute it, expected until a real module ships; (2) `undoAction` only flips
  ledger state, it never reverts the domain data `undoData` describes — flagged for S14
  (Huginn's draft-reply execution path, the first realistically-undoable action) to design
  around explicitly.

### Phase 2 — Mímisbrunnr, module 1 (the well)

- [x] **S10 — Embedding spike + decision** · S · **run locally** · ✅ 2026-07-17
  `scripts/rag/embedding-spike.ts` + `scripts/rag/spike-data.ts` (50 synthetic French courtier
  chunks, 20 labeled eval queries, kept in the repo for re-runs). **Decision: Gemini
  `gemini-embedding-001` at `outputDimensionality: 768`** — 100%/100% recall@1/@3 vs Voyage
  `voyage-4`'s 95%/100%, no new vendor while G2 (HDS scope) is still open, and Matryoshka
  dimension flexibility directly serves the S12 M0-index-cap constraint. Full rationale +
  numbers in `decisions.md` 2026-07-17. No fetching/scraping involved — synthetic data only, so
  the datacenter-IP note didn't apply.

- [x] **S11 — Ingestion + chunking + health classifier** · plan on Opus · M · ✅ 2026-07-17
  Pipeline: source doc → chunk → **Haiku health classifier (prompt = tenant config)** → quarantine
  flagged content **before storage/embedding** → embed → store. Quarantine is append-only and
  auditable. This is the D3 posture; it cannot be retrofitted. *Exit:* classifier prompt in config;
  quarantine path unit-tested with health-flavored fixtures; runs as queue jobs (S4). **All 87 tests
  pass.** E2E verified: clean doc → ingested with embeddings (rawText scrubbed); health doc →
  quarantined (hash+verdict only); checksum dedup prevents re-ingest.

- [x] **S12 — Per-tenant vector index + retrieval** · Sonnet · M · ✅ 2026-07-17
  `SearchIndexBudget` singleton added to the **control plane** (`prisma/control/schema.prisma`),
  not the tenant DB — the real Atlas cap is **3 search indexes per cluster on M0** (not the memo's
  2,500 figure; see `decisions.md`), shared across every tenant, so a per-tenant counter couldn't
  see it. `src/lib/rag/index-budget.ts` (`checkAndReserveIndexSlot`, atomic, throws
  `IndexBudgetExceededError` at cap) + `src/lib/rag/vector-index.ts` (`ensureVectorIndex` —
  `createSearchIndexes` with a `vectorSearch` definition over `KnowledgeChunk.embedding`, 768 dims
  cosine; `isVectorIndexReady` — closes the "`$search` on a missing index returns `[]`" trap via
  `$listSearchIndexes`). Wired into `scripts/provision-tenant.ts` (budget check before index
  creation, fails the whole provision loudly). `src/lib/rag/retrieve.ts`:
  `retrieve(prisma, query, opts?)` embeds the query (`embedTexts(..., "RETRIEVAL_QUERY")`, S5
  metering reused), runs `$vectorSearch` via `aggregateRaw`, returns `{docId, chunkId, text,
  score}` — the exact `AgentAction.sources` shape already documented at `events.md:137`, so S14
  can drop results into a ledger proposal with no reshaping. `npm run rag:provision-index`
  backfills tenants provisioned before this session (`crm_demo`). *Exit met:* index built and
  verified `READY`/queryable against `crm_demo`; `retrieve()` returned a real passage (score 0.91,
  correct `docId`/`chunkId`) for a query against actual S11-ingested content; 4 new tests (91
  total); lint/build clean. **M0 cap is now fully spent (3/3)** — onboarding tenant #2 with a
  knowledge base requires the Flex/M10 upgrade first (Nicolas does this manually in the Atlas
  console; `checkAndReserveIndexSlot` will hard-block, not silently skip, until then).

- [x] **S13 — RAG demo surface** · Sonnet · S · ✅ 2026-07-17
  `/mimisbrunnr` (new route, joined the existing `mimir` realm — `src/lib/realms.ts`,
  `src/components/sidebar.tsx`, no new realm needed). Server component mirroring
  `heimdallr/inbox/page.tsx`'s pattern (`verifySession` → `getTenantDb` → read `searchParams.q`)
  with a plain GET `<form>`, not a debounced client fetch — `retrieve()` calls the Gemini
  embedding API per query, so per-keystroke firing would burn AI budget for no benefit on a demo
  page. Calls `retrieve()` (S12) directly, batch-fetches `KnowledgeDocument` titles for display
  (UI-only enrichment, doesn't touch `retrieve.ts`'s stable `Passage[]` contract that S14 depends
  on). Read-only — no server action, no ledger, no `AgentEvent`. *Exit met:* verified in-browser
  against `crm_demo` — query "base de données CRM" returned the real seeded passage with correct
  document title and a plausible score (0.90); sidebar grouping/ember accent correct; no
  horizontal overflow at 375px; dark theme confirmed; lint/build clean. **Found, not fixed here:**
  the one seeded `KnowledgeDocument`'s text is mojibake (ingested via curl through a cp1252
  PowerShell console during S11 testing — the exact trap CLAUDE.md warns about) — now visible for
  the first time since no UI queried `KnowledgeChunk` text before S13. Flagged as a follow-up task,
  not a regression in this session's code.

- [x] **S13b — ETL / onboarding import pipeline** · plan on Opus · M · *pulled forward 2026-07-17* · ✅ 2026-07-17
  Shipped as a server-status-driven wizard (`/settings/import`, new "Import" settings tab):
  upload (checksum-idempotent, re-upload resumes the run) → mapping onto the config-driven
  schema (deterministic header-synonym suggestion over NATIVE columns + tenant `FieldDefinition`s,
  saveable as named `ImportMapping` config — no AI) → dry-run report → commit as an Inngest job
  (`system-import-run`, IDs-only payload, 25-row batch steps). New tenant models
  `ImportRun`/`ImportRecord`/`ImportMapping` + additive `importRunId` on Company/Contact/Deal
  (one indexed query = "everything from run X"). Dedupe: SIRET hard key with skip/fillEmpty
  policy, deterministic `IMPORT-<hash>` placeholder for SIRET-less rows, name/domain matches as
  non-blocking hints. Health posture: per-row free-text bundles through the S11
  `classifyBatch`/`partitionByVerdict` unchanged; flagged rows import **minus** their free-text
  fields + hash-only `QuarantineItem`; `rawText`/`ImportRecord.raw` scrubbed (D3 window closed).
  Deliberately NOT through the Heimdallr ledger — admin-commanded imports are human actions
  (rationale in `decisions.md` 2026-07-17). Pure libs in `src/lib/import/` (64 new tests, 155
  total). `tenant:provision` gained `--no-vector-index` (M0 cap 3/3 would block new tenants).
  *Exit met:* 13-row synthetic export landed E2E in fresh `import_demo` tenant (10 created /
  2 dupes skipped / 1 bad-SIRET error / 1 health row quarantined at 0.99 confidence, notes
  stripped); re-commit and re-upload both converged with zero new writes; both themes + 375px
  verified; `docs/mimir/onboarding.md` drafted (approver, OAuth/G1, G2 inventory, DPA, export
  format, autonomy ramp, go-live checklist).

- [x] **Checkpoint — Phase 2 wrap** · reflection, no code · XS · ✅ 2026-07-17
  Mímisbrunnr (the well) is retrieval infra for Huginn/Muninn/Bragi — check it actually serves what
  they'll need before building on it. Demo the RAG query surface, sanity-check retrieval quality
  against the S10 embedding decision now that real chunks are indexed, and confirm the index-budget
  counter is tracking correctly. Is G2 (HDS scope) resolved yet? Phase 3 is gated on it — if not,
  decide whether to reorder Phase 4 work ahead of Huginn rather than idling.

### Phase 3 — Huginn, module 2 · ✅ G2 closed 2026-07-18 · G1 (OAuth prod/CASA) only gates real tenant go-live, not S14 build

- [x] **S14a — Mimir OAuth client setup** · **human, no Claude Code model needed** · XS · ✅ 2026-07-18
  Fresh Google Cloud project + OAuth client in Testing mode, test user added, consent screen not
  published. `mimir/.env` (repo root, this repo's own file — not `avelior-analytics/`) has
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI` all set, redirect URI
  `http://localhost:3001/api/integrations/google/callback` matching Mimir's dev port (3001, not
  the baseline's 3000) — confirmed also registered as an Authorized redirect URI on the Google Cloud
  client itself. Actual OAuth-flow completion (clicking through consent) deferred to S14b as its
  first functional check, since that's real code exercise rather than config verification.
- [x] **S14b — Draft pipeline** · plan on Opus · M · ✅ 2026-07-18
  Reuse the inherited Gmail ingestion path; classify support-shaped email (Haiku) → retrieve (S12) →
  draft (Sonnet) → write ledger proposal. Support-prompt pack is per-tenant config. HDS quarantine
  applies upstream (S11). Assumes S14a's Testing-mode OAuth client + env vars already in place — no
  CASA needed, works immediately, refresh tokens just expire ~7d (reconnect from dashboard). G1's
  CASA/verification track only becomes a hard blocker at real-tenant go-live, since Testing mode caps
  at 100 explicitly-added test users. See G1 note in §1.
  **Shipped:** Inngest `huginn-inbox-scan` + `huginn-draft-email` (`src/lib/jobs/huginn-draft.ts`,
  domain logic `src/lib/huginn/draft.ts`), `Activity.huginnStatus` marker (isSet:false scan),
  prompt pack `huginn.support_reply.{classify,draft}` seeded, `/api/huginn/scan` trigger + cron
  wiring, 9-doc courtier knowledge pack ingested into crm_demo, dev scripts under `scripts/huginn/`.
  Verified on 30 fixture/demo emails: 10 DRAFTED (PROPOSED AgentActions, 8 sources each, prompt
  pinned, expires +7d), 6/6 health emails QUARANTINED (hash+verdict only), 14 skipped, re-scan
  idempotent. **OAuth click-through (S14a completion): done 2026-07-18.** The initial
  `redirect_uri_mismatch` was a stale Google client in `.env`; once the correct Mimir-project OAuth
  client was wired in and its Authorized redirect URI confirmed, consent completed cleanly —
  control-plane `Integration` row is `ACTIVE` for `nt.nicolas.toppo@gmail.com` with all expected
  scopes (gmail.readonly, gmail.send, calendar.readonly/events). **Parked, not blocking:** a full
  `GET /api/cron` run against the real inbox timed out in this session (likely the Inngest dev
  server wasn't running, or a large first-sync backfill on a real Gmail account) — worth a quick
  re-check with Inngest dev up before relying on the live cron path, but doesn't affect S14b's
  fixture-driven verification above. Also still open: `sweepExpired` has no cron; Gmail `threadId`
  not persisted (S15 send path resolves via `rfc822msgid:`).
- [x] **S15 — Draft surface + graduation stats** · Sonnet · M · ✅ 2026-07-18
  `HeimdallrActionRow` gained a type-aware branch for `email.draft_reply`: To/Objet/Corps display
  instead of raw JSON, and edit-then-approve switched from a JSON textarea to structured
  Objet/Corps fields for that type (generic JSON view/edit unchanged for every other type).
  Graduation math mirrors S9's breaker shape exactly: `graduationDecision`/`isGraduationEligible`
  (pure, `state-machine.ts`, 9 new unit tests) — unedited-rate over `graduationWindowDays`, gated
  by `breakerMinSample`, never-graduates floor is `level === 1 && maxLevel >= 2` (excludes
  `finance.commitment`/`legal.communication`'s `maxLevel: 1` by construction). `getUneditedStats`/
  `listGraduationCandidates` (read, `queries.ts`) + `promoteCategory`/`evaluateGraduation`/
  `sweepGraduationEligible` (write, `ledger.ts`, one transaction, `level_changed` event with
  `cause: "graduation"` carrying the rate numbers). Not wired to a cron — same deferred posture as
  `sweepBreachedCategories` (S9); runs manually via `scripts/heimdallr/run-graduation-sweep.ts`.
  Inbox gained a read-only "Progression vers le niveau 2" card (no mutation on render) showing
  live unedited%/sample per eligible category. *Exit met:* `npm run test` green (171 total,
  82 in state-machine.test.ts); verified end-to-end against `crm_demo` — a real S14b fixture
  draft rendered To/Objet/Corps, edit-then-approve round-tripped with `wasEdited: true` and the
  correct `editedPayload`, the progress card updated live (0/10 → 1/10); seeded 40 synthetic
  approved actions (38 unedited) to hit the 95% threshold, ran the sweep, confirmed
  `AutonomyConfig.level` flipped 1→2 with the expected `level_changed` event, then confirmed the
  sweep and the progress card both correctly went silent post-graduation. All scratch data
  reverted (including the fixture row's original PROPOSED state) after; lint/build clean.

- [x] **Checkpoint — Phase 3 wrap** · reflection, no code · XS · **skipped 2026-07-18 (explicit call)**
  Nicolas chose to skip straight to Phase 4 rather than run the reflection pass. Freyja (S25) and
  Le Bureau (C5) stay logged as proposed-but-unconfirmed in `decisions.md` — scope still needs
  confirming before either is built, since that confirmation was this checkpoint's job.

### Phase 4 — Remaining realms (order per memo)

- [x] **S16 — Muninn: RCA templates (config) + doc generation + versioning** · Sonnet · M · ✅ 2026-07-18
  New `RcaTemplate` (document structure — ordered sections, each pointing at a `PromptTemplate`
  key) + `RcaDocument` (the versioned artifact: approving a regeneration inserts a new version
  and flips the prior ACTIVE row to SUPERSEDED — same immutable-history shape as `PromptTemplate`,
  applied to the generated document). Seeded one `muninn.rca_doc.default` template (contexte /
  cause_racine / impact / resolution / prevention) + 5 section `PromptTemplate` rows; the
  already-reserved `muninn.rca_doc` `AutonomyConfig` category needed no change. Pipeline
  (`src/lib/muninn/draft.ts`, `src/lib/jobs/muninn-draft.ts`) mirrors Huginn's shape exactly: HDS
  gate (S11, fail closed) → per-section retrieve (S12) + draft (Sonnet) → `proposeAction`. Unlike
  Huginn's inbox sweep, Muninn is manually triggered per `Activity` (no ticket/incident model
  exists in the CRM baseline to scan) via `POST /api/muninn/generate` — no UI trigger button this
  session, verified via script instead, matching how Huginn shipped before its own UI existed.
  **Closed the Phase 1 checkpoint's gap #1** (`decisions.md` 2026-07-17: "nothing calls
  `executeAction` yet") — `src/lib/muninn/executor.ts` is the first real executor: approval writes
  the versioned `RcaDocument` and calls `executeAction` with `undoData`; undo reverts it (restores
  the previously-ACTIVE version). This is a Muninn-specific executor/reverter, not the generic
  dispatcher other modules will eventually need — gap #2 stays open, by design, for a future
  session. `heimdallr-action-row.tsx` gained a `doc.rca_draft` type branch (section blocks +
  per-section edit-then-approve textareas, same pattern as S15's `email.draft_reply`). *Exit met:*
  `npm run test` green (191 total, 10 new); verified end-to-end against `crm_demo` — a scratch
  incident Activity produced a well-grounded 5-section draft (correctly cited the knowledge base's
  actual SLA/réclamation procedures, hedged where facts were missing, invented nothing), approved
  to `RcaDocument` v1 ACTIVE, regenerated + approved to v2 ACTIVE with v1 SUPERSEDED, undid v2 and
  confirmed v1 restored ACTIVE; inbox UI confirmed rendering the section branch and the
  edit-then-approve textareas correctly (both via browser). All scratch data reverted (including
  resetting `muninn.rca_doc`'s autonomy level back to 0) after; lint/build clean.
- [ ] **S17 — Nornir: dashboards as config** (SavedView/widget pattern over events emitted since S7) · Sonnet · M
      **Hero surface (rescoped 2026-07-17): the business pilot dashboard** — the whole company
      at a glance — plus agent-activity feed and the **token-usage UI** over the S5
      `AiUsage`/`AiBudget` data (today CLI-only in `scripts/ai/usage-report.ts`).
- [ ] **S18 — Bragi (part 1): brand-voice pack + content calendar config + generate-to-ledger** · Sonnet · M
      Publishing connector is a separate decision spike — don't bundle it.
- [ ] **S19 — Forseti: compliance UI + scheduled snapshot** · Sonnet · S — cheapest module, substrate exists.

- [ ] **Checkpoint — Phase 4 wrap / platform retro** · reflection, no code · XS
  All seven realms exist. Step back further than the per-phase checkpoints: demo the platform
  end-to-end across modules, review the original memo's D1–D5 against what actually got built and
  note where reality diverged and why, and decide what's next — harden/polish existing modules,
  pick up the parallel UI/premium tracks, or scope a genuinely new module. This is also the moment to
  revisit the permanent-parallel-vs-merge-back question (§0.5) with a full platform to judge it by.

### Phase 5 — Odin, the orchestration layer *(committed 2026-07-17, see `decisions.md`)*

The hierarchical agent org: a top-level agent sets objectives and cascades directives down to
module agents (CEO → Directors → Managers → Employees). Directives are tenant config; **every
decision at every level still flows through the Heimdallr ledger**, and per-category
`AutonomyConfig` keeps governing execution rights — the hierarchy sets objectives, never
bypasses D2. Deliberately sequenced after Phase 4 so it's designed against real module agents,
not guesses.

- [ ] **S20 — Odin design (no code)** · Opus, plan mode · M
      Directive schema, objective decomposition, agent-to-agent delegation shape, how directives
      map onto autonomy categories, what the ledger records at each hierarchy level. Same
      "worth over-thinking" tier as S2 — this is the second schema that can't be backfilled.
- [ ] **S21 — Odin implementation** · Sonnet · M (split if S20 says so)

- [ ] **Checkpoint — Phase 5 wrap** · reflection, no code · XS

### Phase 6 — New realms *(committed 2026-07-17, priority order fixed)*

- [ ] **S22 — Customer Success realm** · plan on Opus · M
      Health scoring, renewal motion, churn signals, CS agent proposing through the ledger.
      Closest to existing data (renewal deals already seeded in `crm_demo`) — that's why it's
      first.
- [ ] **S23 — Legal: grow Forseti** · Sonnet · M
      From compliance-tracking UI into a draft-and-approve legal agent (contract review, terms
      drafting). **Never graduates past `draft_approve` — permanent, code-enforced** (same
      defense-in-depth as the health floor).
- [ ] **S24 — HR realm** · plan on Opus · M
      Hiring pipeline, onboarding docs, policy Q&A over Mímisbrunnr. Last on purpose: least
      defined, least urgent for the broker vertical. Scope it fresh at the time.

- [ ] **S25 — Freyja: paid-marketing realm (ad connectors + autonomous campaign agent)** · plan on Opus · M
      *(new — proposed at the Phase 3 checkpoint 2026-07-18)* A dedicated **marketing realm** —
      working name **Freyja** (goddess of allure/prosperity; the demand-gen counterpart to Bragi's
      brand/content work, S18). Two halves, and the split matters:
      **(a) Insight — connectors + one pane of glass.** Per-tenant OAuth connectors to the paid-ad
      platforms — **Google Ads** and **Meta (Facebook/Instagram) Ads** first, LinkedIn/TikTok later —
      each a *config-driven* connector (credentials + account IDs as tenant config, never hardcoded;
      same per-tenant integration pattern as Gmail/Calendar in `INTEGRATIONS.md`). Pull campaign
      metrics (spend, impressions, clicks, CPC/CPA/ROAS, conversions) on a cron into a normalized
      `CampaignInsight` shape so every platform reads the same, and surface them in **one unified
      dashboard** (reuse the Nornir S17 SavedView/widget pattern — don't build a second dashboard
      engine). Read-only until (b) is trusted.
      **(b) Action — the autonomous marketing agent.** The agent reasons over the unified insight and
      **proposes campaign decisions** — budget shifts, pausing losers, scaling winners, bid/audience
      tweaks, creative rotation — to *make campaigns powerful and effective*. **Every decision goes
      through the Heimdallr ledger (D5, no exceptions)**: new autonomy categories (e.g.
      `marketing.budget_change`, `marketing.campaign_pause`, `marketing.bid_adjust`) start at
      `level: 0` (propose-only), and only graduate per the S9/S15 breaker+graduation math once the
      approve/edit history earns it. **Spend is real money — cap the blast radius:** a hard
      per-category `maxLevel` and a max-daily-budget-delta guardrail so even a graduated agent can't
      swing spend without a human, mirroring the `finance.commitment` posture.
      *Model:* plan on **Opus** (connector-normalization + autonomy-category design is
      schema-that-can't-be-backfilled tier); implement on **Sonnet**; the runtime agent runs on
      **Sonnet** for the decision drafts (per §0 runtime table — customer/spend-facing reasoning),
      **Haiku** for metric summarization/classification. Split into S25a (connectors + insight
      dashboard) and S25b (autonomous agent + new autonomy categories) if it grows past M.
      *Depends on:* S7 ledger, S17 Nornir dashboard pattern; benefits from S18 Bragi brand voice for
      ad-copy suggestions. Log the realm name + autonomy categories in `decisions.md` when scoped.

### Cosmos UI track (parallel, can run alongside Heimdallr phases)

The Mimir UI pivoted to a dark-first cosmic universe design (one realm per agent module, orbital
home surface, abyss/bone/brass palette). Phase 1 (realm tokens + grouped sidebar) shipped in commit
`e740bcd` but is still on the light theme — these sessions reconcile dark-first theming and build
the continuity/motion layer. Reference the `mimir-cosmos` skill and approved concept prototype for
the full design system.

- [x] **C1 — Dark theme + realm layer reconciliation** · **Sonnet** · S · ✅ 2026-07-17
  Reconciled dark `[data-theme="dark"]` tokens in `globals.css` with the abyss/bone/brass/well/
  ember/live palette from `docs/mimir-architecture.html`: brand → brass (was indigo), surfaces →
  abyss/panel/panel-2, text → bone/mist/dim, realm accents reassigned (chasse → well teal,
  tresor → live green, mimir → ember, since brass moved to neutral `--brand`). Light theme and
  the light-default toggle behavior left untouched — confirmed with Nicolas to defer the
  default-theme flip to a later Cosmos session.
  *Exit:* sidebar grouped by realm with correct hues in light and dark; `data-realm` attribute set
  on app shell from route segment.

- [x] **C2 — Navigation continuity + realm shifts** · **Sonnet** · M · ✅ 2026-07-17
  Enabled `experimental.viewTransition`, anchored sidebar/topbar (`viewTransitionName`, never
  animate), wrapped routed content in `<ViewTransition>` scoped to a `realm-shift` type applied
  only to sidebar links that cross realms (`realmForPath` comparison). CSS: `.realm-shift`
  crossfade+rise keyframes, `prefers-reduced-motion` kills all view-transition animation.
  *Exit:* realm changes feel like travel, not replacement — verified in-browser (Relation→Chasse→
  Trésor crossfades + hue sweep, sidebar/topbar anchored, both themes, no console errors).

- [x] **C2.5 — Cosmos observatory (orbital home surface)** · **Sonnet** · M · ✅ 2026-07-17
  Not originally scoped in C1–C4 — added mid-session per Nicolas's request for the full visual
  reinvention from the approved concept artifact ("Mimir — Le Cosmos"), not just accent theming.
  Replaced `/dashboard`'s greeting header with `src/components/observatory.tsx`: starfield canvas,
  SVG light-threads, a real-data hub + four realm orbs (relation/chasse/tresor live with real
  counts; mimir shown as "planifié" — no fake Heimdallr/Mímisbrunnr stats), hover/pin instrument
  panel. Hero is always dark (scoped `data-theme="dark"` on an inner wrapper, not `<html>`) — this
  exposed and fixed a real C1 bug: `relation`'s `--realm: var(--brand)` fallback only resolves at
  its declaring element (`:root`), so a nested dark scope below `<html>` never picked it up
  without an explicit `[data-theme="dark"] [data-realm="relation"]` rule (added to `globals.css`).
  Below-the-fold dashboard content (todo list, finance strip, KPI grid, activity feed) relocated
  unchanged beneath the hero. Added `Fraunces` display serif (`--font-display`), scoped to the
  observatory only. Also fixed an unrelated ESLint gap: `.claude/worktrees/**` wasn't excluded,
  so a stray leftover worktree's generated code was failing repo-wide lint.
  *Exit:* verified in-browser — real stats per orb match live `crm_demo` data, hero stays dark in
  both themes while below-fold content follows the toggle, mobile 2-col grid fallback, no
  hydration/console errors, `npm run lint`/`build` clean.

- [ ] **C3 — Shared-element morphs + Suspense reveals** · **Sonnet** · M
  Implement shared-element morphs (row name → detail header) on companies, contacts, deals. Add
  Suspense skeleton reveals. Reference `references/mechanics.md` for implementation recipes; don't
  re-derive.
  *Exit:* "deeper into a realm" transitions morph the row smoothly into the detail view.

- [ ] **C4 — Atmosphere + final polish** · **Sonnet** · S
  Add header auras (realm-subtle gradient in `PageHeader`), realm-tinted chart primary series,
  `::selection` styling. Run `design-review` at both themes. Verify "cosmos outside, clarity
  inside" — immersive surfaces stay vibrant, working surfaces (tables, filters) keep design-system
  density.
  *Exit:* visual polish complete; design review green at both themes.

- [ ] **C5 — 🥚 Easter egg: "Le Bureau" — pixel-art agents' house at work** · plan on Opus, implement on Sonnet · M
  *(new — proposed at the Phase 3 checkpoint 2026-07-18)* A hidden tab in the cosmos that renders
  the Mimir agents as **pixel-art characters working in an office** — Heimdallr, Huginn, Muninn,
  Nornir, Bragi, Forseti, Odin (and Freyja once S25 lands) each a little Norse pixel character that
  walks around, sits at its desk, and animates what it's doing (typing = drafting, reading =
  retrieving, waiting = a pending ledger proposal). Pure delight surface; not on the main nav —
  unlocked by an egg (e.g. a Konami sequence or clicking the Mimir well glyph N times).
  **Source repo:** vendor **https://github.com/pixel-agents-hq/pixel-agents** — it visualizes Claude
  Code agents as pixel characters in an office via the Claude Code Hooks API (React 19 + Vite +
  Canvas 2D webview, Fastify server). Reskin it into the Mimir cosmos: abyss/bone/brass palette,
  Norse-character sprites, the office framed as the realms' shared "bureau." Decide the vendor
  mechanic at plan time — embed the `webview-ui` as a route vs. run its standalone CLI/server behind
  the egg — and record it in `decisions.md` (don't fork-to-improve; treat it as a vendored dep).
  **Model:** *build* the integration on **Sonnet** (plan the vendoring approach on **Opus** — pulling
  a foreign monorepo into the app shell is an architecture call). *The pixel agents themselves are
  driven by **Claude Code** via its Hooks API* — that's the repo's runtime, unchanged; no extra API
  model is wired for the animation. (If you later auto-generate sprite variants instead of hand-
  drawing them, that's an image model — but see the asset note below: the intent is **your own art**.)
  **Where to feed your own pixel art (do this by hand — this is the fun part):** drop your sprites
  into the vendored **`webview-ui/public/assets/`** tree —
  • **characters** → one folder per Norse agent with its PNG sprite sheet + a `manifest.json`
    declaring rotation groups and per-state animation frames (idle / walk / type / read / wait);
  • **furniture, floors, walls** (the "house") → folders under `webview-ui/public/assets/furniture/`,
    each a PNG + `manifest.json` (the repo already ships open-source office assets there as the
    template to copy).
  For art kept **outside** the repo, use the app's Settings → **"Add Asset Directory"** and follow
  the format in the repo's **`docs/external-assets.md`**. Map each Norse agent → its realm accent so
  the pixel character's palette matches its cosmos hue.
  *Exit:* egg unlocks the hidden tab; the seven+ agents render and animate; at least one agent
  visibly reacts to a real Mimir event (a pending Heimdallr proposal → that agent shows "waiting");
  reskinned to the cosmos palette; both themes sane; documented in `decisions.md` (vendor mechanic +
  where custom art goes).

**Parallel premium track** (slot into gaps, one S-session each): per-tenant branding pull-forward →
Cmd+K palette on Atlas Search → MCP connector.

---

## 3. Token rules

1. **One module slice per session, then `/clear`.** Context past ~60% is where quality drops and
   tokens burn fastest.
2. **Point, don't paste.** Reference exemplar files by path — the outreach breaker, `LeadOneQuota`,
   `/inbox`. The repo is the spec. (All still present, inherited from the baseline.)
3. **Subagents for broad searches**; keep exploration out of the main context.
4. **Plan mode is the token saver, not a cost.** An approved plan prevents the rewrite loop, which
   is where sessions actually get expensive.
5. **Keep CLAUDE.md short and stable**; per-module docs loaded on demand. Every line is paid on
   every session. The inherited CLAUDE.md is longer than this repo needs — S1 fixes that.
6. **Don't run the dev server or screenshots unless the session is UI work.**
7. **Never open both repos in one session.** Cross-repo work (pulling a baseline fix across) is its
   own small session with an explicit diff, not a side quest.

## 4. Bug rules

1. **Invariants in CLAUDE.md**, so every session inherits them: `isSet: false` for any
   "not yet processed" query · additive schema only · router-only DB access · tokens-not-literal
   colors · server/client module split.
2. **Tests only where they pay:** pure logic (state machine, breaker, graduation math, quotas,
   chunking). No UI test suites. `npm run test` joins the `/ship` chain at S7.
3. **One code path for side effects** (the ledger) means one place bugs can live. Resist every
   module-local shortcut — that's the D5 rule doing bug-prevention work.
4. **The new cluster only.** The highest-severity mistake available in this repo is an `.env` or
   script pointing at the prod cluster. Check before any script run; `grep` the old cluster host as
   part of S0b's exit.
5. **Zod at every boundary** — agent tool inputs, ledger transitions, queue payloads.
6. `--dry` first for any script touching data (the `clean:inbox` precedent). Less lethal here than in
   prod, but the habit is what transfers back to the baseline repo.
7. **Additive-only schema, still** — not because a live user would break, but because it keeps
   merge-back cheap if that's the decision.

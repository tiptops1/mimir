# Mimir — dev roadmap, Claude Code session plan

> Companion to `AGENTIC-PLATFORM-DECISION-MEMO.md`. This is the execution plan: one checkbox ≈ one
> Claude Code session. Tick as you go — this file is the cross-session memory, same as the Vision RM
> roadmaps. Lives at `docs/mimir/roadmap.md` **in the Mimir repo**.
>
> Ritual per session (unchanged from the brief): **plan mode → approve → execute → lint → build →
> commit → update this file → `/clear`.** Push to `main` only on an explicit "push".
>
> **Revised 2026-07-15 — D6: separate environment.** Mimir is no longer built inside the baseline
> repo. It gets its **own repo, own Atlas cluster, own Vercel project, own cron schedules, own
> secrets**, seeded from a duplicate of the Vision RM baseline at its current commit. See §0.5 and
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

| | **Vision RM (prod baseline)** | **Mimir (new)** |
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
- The duplicated Vision RM code is a **baseline, not a fork to improve**. Bug fixes that belong to
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
- [ ] **G2** — ask the baseline's business contact what a typical month of client email contains →
      close the HDS decision **before Huginn ingests anything**.
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

- [x] **S0 — New repo + environment, Vision RM duplicated as baseline** · **Opus, plan mode** · M · ✅ 2026-07-15
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
  rules, `mimir-ship`/`mimir-env-guard` ritual, no Vision-RM-only content). `docs/roadmap.md` +
  `docs/product-roadmap.md` (Vision RM's own dated build logs) deleted — not Mimir's history.
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

- [ ] **S7 — Ledger core + state machine** · plan on Opus, implement on Sonnet · M
  Write API + lifecycle transitions with guards (only `proposed` can be approved; `executed` +
  reversible → undoable; edits captured as diffs for graduation stats). Zod-validate every
  transition. **Add vitest here** and unit-test the state machine — first tests in the repo, pure
  logic only. *Exit:* tests green; `npm run test` added to the `/ship` chain.

- [ ] **S8 — Approval inbox UI** · Sonnet · M
  Extend the inherited `/inbox` triage pattern (not fork): pending proposals with source passages +
  triggering context, approve / edit-then-approve / reject, French labels from config, design tokens
  only. *Exit:* full loop demo-able on `crm_demo` with a hand-inserted proposal.

- [ ] **S9 — Undo + circuit breaker** · Sonnet · S
  Generalize the inherited outreach bounce-breaker: per-category edit-rate / negative-signal breaker
  that auto-demotes to `draft_approve` + writes an `AgentEvent`. Undo window on reversible actions.
  *Exit:* breaker unit-tested; demotion visible in the inbox.

- [ ] **Checkpoint — Phase 1 wrap** · reflection, no code · XS
  Heimdallr (the bridge) is the substrate every later module proposes actions through — this is
  the highest-leverage checkpoint to get right. Demo the full propose → approve/edit/reject →
  execute → undo loop on `crm_demo` with a hand-inserted proposal. Does the breaker/graduation
  design (S9) hold up against a real edit, or does it need adjusting before Mímisbrunnr starts
  writing proposals against it? Revisit whether any inbox UX gaps found while demoing are worth
  a follow-up session before Phase 2, or can ride along later.

### Phase 2 — Mímisbrunnr, module 1 (the well)

- [ ] **S10 — Embedding spike + decision** · S · **run locally**
  Gemini embeddings vs Voyage on ~50 real-ish French insurance chunks: retrieval quality, price,
  dimension/index cost. Record in `decisions.md`. Remember datacenter-IP scraping limits if any
  fetching is involved.

- [ ] **S11 — Ingestion + chunking + health classifier** · plan on Opus · M
  Pipeline: source doc → chunk → **Haiku health classifier (prompt = tenant config)** → quarantine
  flagged content **before storage/embedding** → embed → store. Quarantine is append-only and
  auditable. This is the D3 posture; it cannot be retrofitted. *Exit:* classifier prompt in config;
  quarantine path unit-tested with health-flavored fixtures; runs as queue jobs (S4).

- [ ] **S12 — Per-tenant vector index + retrieval** · Sonnet · M
  Index provisioning wired into `tenant:provision` + an index-budget counter (2,500/cluster cap is
  the scaling constraint — count from day one; **the new cluster gets its own budget**).
  `lib/rag/retrieve.ts` returning passages with source refs, through the DB router only. Atlas trap:
  `$search` on a missing index returns `[]`, not an error — provisioning must verify the index
  exists.

- [ ] **S13 — RAG demo surface** · Sonnet · S
  Minimal query UI with cited passages. Read-only, no side effects — this is the sales demo.
  *Exit:* demo on `crm_demo` against a seeded knowledge base.

- [ ] **S13b — ETL / onboarding import pipeline** · plan on Opus · M · *pulled forward 2026-07-17*
  The plug-and-play machinery: source connectors (CSV/spreadsheet export, generic CRM export) →
  mapping wizard onto the config-driven schema (`FieldDefinition` means no per-customer
  migration) → dedupe → the same S11 health-classifier quarantine → idempotent, audited import
  runs as Inngest jobs (IDs-only payloads, S4 rule). Reuses the S11 chunk/quarantine pipeline —
  that's why it lives here and not later. Tested against synthetic exports (no real customer
  yet — accepted in `decisions.md`). *Exit:* a synthetic "existing CRM export" lands in a fresh
  demo tenant end to end, re-runs are idempotent, every imported record traceable to its import
  run; **customer-side onboarding doc drafted** (OAuth grant, G2 data inventory, designated
  approver, DPA, exports, autonomy ramp policy).

- [ ] **Checkpoint — Phase 2 wrap** · reflection, no code · XS
  Mímisbrunnr (the well) is retrieval infra for Huginn/Muninn/Bragi — check it actually serves what
  they'll need before building on it. Demo the RAG query surface, sanity-check retrieval quality
  against the S10 embedding decision now that real chunks are indexed, and confirm the index-budget
  counter is tracking correctly. Is G2 (HDS scope) resolved yet? Phase 3 is gated on it — if not,
  decide whether to reorder Phase 4 work ahead of Huginn rather than idling.

### Phase 3 — Huginn, module 2 · ⚠ blocked on G2

- [ ] **S14 — Draft pipeline** · plan on Opus · M
  Reuse the inherited Gmail ingestion path; classify support-shaped email (Haiku) → retrieve (S12) →
  draft (Sonnet) → write ledger proposal. Support-prompt pack is per-tenant config. HDS quarantine
  applies upstream (S11). *Needs a Mimir-environment OAuth client — see the G1 note in §1.*
- [ ] **S15 — Draft surface + graduation stats** · Sonnet · M
  Drafts render in the Heimdallr inbox; approve/edit/reject events feed graduation stats **from the
  first draft ever shown**. Graduation math + never-graduates list (money, legal, health-flagged) as
  pure, tested functions.

- [ ] **Checkpoint — Phase 3 wrap** · reflection, no code · XS
  Huginn is the first module that writes real proposals against a real inbound channel (email) —
  the first live test of the whole Heimdallr loop under real-world noise. Demo drafts actually
  generated from real-shaped support email, check graduation stats are accumulating sensibly from
  first draft, and look for anything Huginn needed that Phase 1/2 didn't provide (a retrieval gap,
  an autonomy-category gap, a UX gap in the inbox). Good moment to ask whether Muninn/Nornir/Bragi
  in Phase 4 still make sense in the planned order, or whether what shipped here reprioritizes them.

### Phase 4 — Remaining realms (order per memo)

- [ ] **S16 — Muninn: RCA templates (config) + doc generation + versioning** · Sonnet · M
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
  pick up the parallel premium track, or scope a genuinely new module. This is also the moment to
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
7. **Never open both repos in one session.** Cross-repo work (pulling a Vision RM fix across) is its
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

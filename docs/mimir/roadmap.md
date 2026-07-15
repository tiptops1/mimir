# Mimir — dev roadmap, Claude Code session plan

> Companion to `AGENTIC-PLATFORM-DECISION-MEMO.md`. This is the execution plan: one checkbox ≈ one
> Claude Code session. Tick as you go — this file is the cross-session memory, same as the Vision RM
> roadmaps. Lives at `docs/mimir/roadmap.md` **in the Mimir repo**.
>
> Ritual per session (unchanged from the brief): **plan mode → approve → execute → lint → build →
> commit → update this file → `/clear`.** Push to `main` only on an explicit "push".
>
> **Revised 2026-07-15 — D6: separate environment.** Mimir is no longer built inside
> `avelior-analytics`. It gets its **own repo, own Atlas cluster, own Vercel project, own cron
> schedules, own secrets**, seeded from a duplicate of Vision RM at its current commit as the
> baseline. See §0.5 and S0. Everything below assumes that split.

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

| | **Vision RM (prod)** | **Mimir (new)** |
|---|---|---|
| Repo | `avelior-analytics` | new repo, seeded from `avelior-analytics` @ `719f842` |
| Atlas | `crm-railway` cluster (legacy name), prod data | **new project/cluster**, no prod data, ever |
| Host | existing Vercel project | **new Vercel project** |
| Crons | cron-job.org, 4 routes ✅ verified scheduled | **new schedules, new `CRON_SECRET`** |
| Secrets | existing `.env` | **all fresh** — never reuse `ENCRYPTION_KEY`, `SESSION_SECRET`, `CRON_SECRET` |
| Live user | Christopher (`crm_chris`) | none — demo tenants only |

**What this buys:** a real staging environment for the first time. The brief's standing constraint
("local `.env` points at prod Atlas — every script run is production") **no longer applies in the
Mimir repo**. It still applies in `avelior-analytics`.

**What this costs — accept it consciously:** the D4/D5 reuse story now means *inheriting a copy* of
`/inbox`, `AuditLog`, the outreach ledger and the DB router, not extending the live ones. The two
codebases will drift.

**Open decision — record in `decisions.md` at S0:** is Mimir a *permanent parallel platform*, or a
proving ground whose modules get **merged back** into `avelior-analytics` once validated? This
changes how hard you work to keep the baseline in sync. Don't leave it implicit.

**Baseline discipline (new standing rules):**
- The duplicated Vision RM code is a **baseline, not a fork to improve**. Bug fixes that belong to
  Vision RM go in `avelior-analytics` and get pulled across — not fixed only in Mimir.
- Anything gated to tenant #1 in the baseline (legacy IMAP/ICS/`FIREFLIES_API_KEY` fallbacks,
  `TENANT1_SLUG` assumptions, Christopher-specific seed config) is **dead weight on day one** —
  identify it at S0, strip or neutralize it before building on top.
- The Mimir repo has **no production user**. "Don't break the live app" is replaced by "never point
  this repo at the prod cluster."

---

## 1. Pre-flight

**Human/business track (runs in parallel, not Claude Code work):**
- [ ] **G1** — start Google OAuth Production + CASA process now. Longest external lead time.
      *Note: the Mimir environment needs its own OAuth client too — G1 work should account for it.*
- [ ] **G2** — ask Christopher what a typical month of client email contains → close the HDS
      decision **before Huginn ingests anything**.
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

### Phase −1 — Environment split (new, blocks everything)

- [x] **S0 — New repo + environment, Vision RM duplicated as baseline** · **Opus, plan mode** · M · ✅ 2026-07-15
  Run **outside** `avelior-analytics` (it creates a sibling repo). Do not touch `avelior-analytics`
  in this session.
  Scope: decide the duplication mechanic (clone/fork vs. copy-source) and record why; create the new
  repo seeded from `avelior-analytics` @ current commit; new Atlas project/cluster; new Vercel
  project; fresh `ENCRYPTION_KEY` / `SESSION_SECRET` / `CRON_SECRET`; `.env` pointed at the **new**
  cluster; identify and flag every tenant-#1-specific / prod-specific artifact that shouldn't carry
  over; bootstrap one demo tenant so the baseline provably runs.
  *Exit:* new repo builds + runs against the new cluster, one demo tenant logs in, prod untouched,
  the permanent-parallel-vs-merge-back decision written to `docs/mimir/decisions.md`, and the manual
  Atlas/Vercel steps you must do by hand listed out.

- [ ] **S0b — Baseline strip-down** · Sonnet · S
  Execute the strip list S0 produced: remove/neutralize legacy tenant-#1 fallbacks, Christopher seed
  config, dead env vars. Keep the spine (control plane, router, auth, config-driven schema).
  *Exit:* lint/build green on the new repo; `grep` for the prod cluster host returns nothing.

### Phase 0 — Groundwork (no gates block this)

- [ ] **S1 — Docs + CLAUDE.md refactor** · Sonnet · S
  In the **Mimir repo**: create `docs/mimir/` (this roadmap, `events.md` stub, `decisions.md` —
  which already holds the S0 entry). Rewrite the inherited `CLAUDE.md` for *this* repo: the six
  standing rules (memo §7) + the `isSet: false` invariant + "every side effect goes through the
  ledger" + the §0.5 baseline rules. Strip Vision-RM-only content the copy dragged in.
  *Exit:* CLAUDE.md under ~300 lines and true for this repo, module docs exist, roadmap committed.

- [ ] **S2 — Event schema + core data model (design only)** · Opus, plan mode · M
  Design: `AgentEvent` taxonomy (module × category × action lifecycle), `AgentAction` ledger record
  (proposed → approved/edited/rejected → executed → undone, with source passages + trigger refs),
  `AutonomyConfig` (per-tenant × per-category level 0–3), `PromptTemplate` (config, not code).
  Generic ontology, French labels in config. Events can't be backfilled — this schema is the one
  thing worth over-thinking. *Exit:* `docs/mimir/events.md` + Prisma model draft reviewed. No code
  pushed.

- [ ] **S3 — Schema implementation + seed** · Sonnet · S
  Implement S2's models in the Mimir repo's `prisma/tenant/schema.prisma`, `db:push` **against the
  new cluster**, extend `config:seed` with default autonomy config (everything `off`, Huginn
  categories at `draft_approve` when enabled). Additive-only still applies — it keeps merge-back
  cheap. *Exit:* lint/build green, seed idempotent.

- [ ] **S4 — Job-queue spike + decision** · Opus for the eval, tiny code · M
  Closes the memo's open decision (Inngest / Trigger.dev / Upstash QStash). Criteria: Vercel 60s
  fit, resumable steps with state in Mongo, per-step retries, cost at your volume, works with
  cron-job.org-style external triggers. Build one proof route: a 3-step agent job that survives a
  step failure. Now cheap to test for real — no live user in this env. *Exit:* decision recorded in
  `decisions.md` + proof route merged behind config.

- [ ] **S5 — AI metering + model router** · Sonnet · M
  `lib/ai/meter.ts` on the `LeadOneQuota` pattern: per-tenant token/cost ledger + hard quota.
  `lib/ai/router.ts`: task class → provider/model (Gemini Flash | Haiku | Sonnet), Batch + caching
  for anything cron-shaped. Every agent call goes through both — no direct fetches from modules.
  *Exit:* inherited enrichment migrated onto the router unchanged in behavior; metering visible via
  a script. **Must exist before customer #2 touches anything agentic.**

- [ ] **S6 — Demo tenant + synthetic data** · Sonnet · S
  Flesh out the S0 bootstrap tenant (`crm_demo`) with synthetic French-broker data via
  `tenant:provision` + seed. *No longer the staging **mechanism** — the whole repo is staging now.
  This is the demo/sales fixture and the default target for every new feature.*
  *Exit:* demo tenant realistic enough to demo against, documented in CLAUDE.md.

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

### Phase 3 — Huginn, module 2 · ⚠ blocked on G2

- [ ] **S14 — Draft pipeline** · plan on Opus · M
  Reuse the inherited Gmail ingestion path; classify support-shaped email (Haiku) → retrieve (S12) →
  draft (Sonnet) → write ledger proposal. Support-prompt pack is per-tenant config. HDS quarantine
  applies upstream (S11). *Needs a Mimir-environment OAuth client — see the G1 note in §1.*
- [ ] **S15 — Draft surface + graduation stats** · Sonnet · M
  Drafts render in the Heimdallr inbox; approve/edit/reject events feed graduation stats **from the
  first draft ever shown**. Graduation math + never-graduates list (money, legal, health-flagged) as
  pure, tested functions.

### Phase 4 — Remaining realms (order per memo)

- [ ] **S16 — Muninn: RCA templates (config) + doc generation + versioning** · Sonnet · M
- [ ] **S17 — Nornir: dashboards as config** (SavedView/widget pattern over events emitted since S7) · Sonnet · M
- [ ] **S18 — Bragi (part 1): brand-voice pack + content calendar config + generate-to-ledger** · Sonnet · M
      Publishing connector is a separate decision spike — don't bundle it.
- [ ] **S19 — Forseti: compliance UI + scheduled snapshot** · Sonnet · S — cheapest module, substrate exists.

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
   prod, but the habit is what transfers back to `avelior-analytics`.
7. **Additive-only schema, still** — not because a live user would break, but because it keeps
   merge-back cheap if that's the decision.

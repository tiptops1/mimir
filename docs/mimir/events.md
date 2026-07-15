# Mimir — event schema + core data model (S2 design)

> Designed 2026-07-15 (S2). This doc is the reviewed artifact; **S3 implements these models
> verbatim** in `prisma/tenant/schema.prisma`. Companion to the decision memo (D2/D3/D5) and
> `decisions.md` (S2 entry closes the design decisions made here).
>
> Four structures: `AgentEvent` (append-only stream), `AgentAction` (the one ledger, D5),
> `AutonomyConfig` (per-category autonomy level + breaker, D2), `PromptTemplate` (prompts as
> tenant config, Path C rule 1). All four live in the **tenant** schema — tenant data only
> through the DB router. The control plane gets nothing new here (per-tenant metering
> aggregation is S5).

---

## 0. Conventions inherited from the baseline (why the models look like this)

- IDs: `String @id @default(auto()) @map("_id") @db.ObjectId`. Refs to control-plane `User` are
  **loose** `String? @db.ObjectId` with no cross-DB relation (AuditLog precedent).
- Status/type fields are **plain strings with a documented vocabulary**, not Prisma enums —
  repo-wide convention (`OutreachMessage.status`, `Enrollment.status`, `LeadCandidate.status`).
  Strings stay config-friendly and additive; enums force schema changes for vocabulary growth.
- Append-only logs use a single `at DateTime @default(now())`, no `updatedAt` (AuditLog,
  StageChange precedent).
- Kill-switch triple `paused / pausedReason / pausedAt` + threshold columns: copied from
  `OutreachConfig` (logic pattern: `src/lib/outreach/guardrails.ts`).
- Config rows are seeded via **upsert by stable key** in `src/lib/default-config.ts` →
  `seedTenantConfig()`; French labels are data on the row, never code.
- Additive-only schema, still (decisions.md 2026-07-15: kept as discipline + cheap cherry-picks).

---

## 1. AgentEvent — the append-only event stream

**Why it exists:** Nornir dashboards (S17) defer indefinitely *iff* structured events are emitted
from day one — events can't be backfilled. Graduation stats (D2) need approve/edit/reject events
from the first draft ever shown. The ledger row holds *current state*; events hold *history*.

### Taxonomy: module × category × action

The taxonomy is the **triple**, stored as three indexed string fields. The dotted form
`module.category.action` appears in docs and log lines only — never parsed from a single column.

**`module`** — who emitted it:

| Key | Realm |
|---|---|
| `heimdallr` | ledger / approval bridge (module 0) |
| `mimisbrunnr` | RAG knowledge base |
| `huginn` | support drafting |
| `muninn` | tech-support / RCA docs |
| `nornir` | telemetry dashboards |
| `bragi` | marketing content |
| `forseti` | compliance |
| `system` | cron, queue, breaker, provisioning infrastructure — so Nornir can chart ops too |

**`category`** — the autonomy category key (same vocabulary as `AutonomyConfig.category`, §3)
for actionable events; a module-local domain for non-actionable ones (e.g. `ingestion`,
`retrieval`, `quota`).

**`action`** — lifecycle verb. Documented vocabulary (open — additions are doc updates, not
schema changes):

| Verb | Emitted when |
|---|---|
| `proposed` | an AgentAction row is created |
| `approved` | PROPOSED → APPROVED (human, or auto at level ≥ 2 with `data.auto: true`) |
| `edited` | approval carried a human edit (emitted *alongside* `approved`) |
| `rejected` | PROPOSED → REJECTED |
| `expired` | PROPOSED → EXPIRED (expiresAt passed) |
| `executed` | APPROVED → EXECUTED |
| `failed` | APPROVED → FAILED |
| `undone` | EXECUTED → UNDONE |
| `breaker_tripped` | a category breaker demoted the level / paused the category |
| `breaker_reset` | breaker cleared (human or cooldown) |
| `level_changed` | AutonomyConfig.level changed (graduation, demotion, manual) |
| `quarantined` | health classifier flagged content pre-storage (D3, S11) |
| `ingested` / `embedded` | Mímisbrunnr pipeline milestones (S11–S12) |
| `run_started` / `run_finished` / `run_failed` | queue job lifecycle (S4) |

### Model draft

```prisma
model AgentEvent {
  id       String   @id @default(auto()) @map("_id") @db.ObjectId
  at       DateTime @default(now())
  module   String   // heimdallr | mimisbrunnr | huginn | muninn | nornir | bragi | forseti | system
  category String   // AutonomyConfig.category key, or module-local domain (ingestion, quota, …)
  action   String   // lifecycle verb — see events.md §1
  actionId String?  @db.ObjectId // loose ref → AgentAction
  runId    String?  // loose ref → queue job/run (run model decided at S4)
  entity   String?  // COMPANY | CONTACT | DEAL | … (AuditLog convention)
  entityId String?  @db.ObjectId
  userId   String?  @db.ObjectId // loose ref → control-plane User (approver/editor), no relation
  data     Json?    // small event-specific payload; big blobs live on AgentAction

  @@index([at])
  @@index([module, category, at])
  @@index([actionId])
  @@index([entity, entityId])
}
```

### Rules

- **Append-only.** Rows are never updated, never deleted.
- **GDPR erasure posture:** an erasure request scrubs `data` and `entityId` on matching rows
  (set to null) but keeps the row — the statistical record (counts, timings, graduation stats)
  survives; the personal data does not. Same posture as the RGPD_ERASE flow in AuditLog.
- `data` stays small (decision metadata, breaker numbers). Draft bodies, diffs, source passages
  live on `AgentAction` — events point at them via `actionId`.
- Every `AgentAction` transition emits exactly one event (plus `edited` alongside `approved`
  when applicable). Emission and transition happen in the same code path (S7's write API) so
  they cannot drift.

---

## 2. AgentAction — the ledger (D5: one bridge for side effects)

Every side-effectful agent proposal across every module is one row here. No module ships its own
approval flow — `/inbox`-style triage UIs (S8) render *this* table.

### Model draft

```prisma
model AgentAction {
  id       String @id @default(auto()) @map("_id") @db.ObjectId
  module   String // emitting module (same vocabulary as AgentEvent.module)
  category String // autonomy category key → AutonomyConfig
  type     String // concrete action, e.g. email.draft_reply | crm.update_field | doc.rca
  status   String @default("PROPOSED")
  // PROPOSED | APPROVED | REJECTED | EXPIRED | EXECUTED | FAILED | UNDONE

  payload       Json    // the proposal as generated (draft body, field diff, doc content, …)
  editedPayload Json?   // payload after human edit; null = approved untouched
  wasEdited     Boolean @default(false) // denormalized for graduation queries

  sources Json? // cited passages: [{ docId, chunkId, quote, score }] (Mímisbrunnr, S12)
  trigger Json? // triggering context: { kind: "email"|"cron"|"manual", refs… }
  entity   String?
  entityId String? @db.ObjectId

  autonomyLevelAtProposal Int  // level in force when proposed — graduation-stat integrity
  promptKey     String?       // PromptTemplate key used to generate the proposal
  promptVersion Int?          // + exact version — pins what produced this output

  reversible Boolean   @default(false)
  undoData   Json?     // whatever execution recorded to reverse itself
  expiresAt  DateTime? // auto-EXPIRED past this (stale drafts don't linger as pending)

  proposedAt DateTime  @default(now())
  decidedAt  DateTime?
  decidedBy  String?   @db.ObjectId // loose ref → control-plane User; null = auto-approved
  executedAt DateTime?
  undoneAt   DateTime?
  error      String?

  @@index([status, proposedAt])
  @@index([category, status])
  @@index([entity, entityId])
}
```

### State machine

```
PROPOSED ──→ APPROVED ──→ EXECUTED ──→ UNDONE   (only if reversible, within undo window)
   │             │             └──→ (terminal otherwise)
   │             └──→ FAILED   (error set; retry = a NEW proposal, no status rewind)
   ├──→ REJECTED
   └──→ EXPIRED   (expiresAt passed; swept by cron)
```

Transition guard table (implemented + unit-tested at S7):

| From | To | Guard |
|---|---|---|
| PROPOSED | APPROVED | human decision, or auto when `AutonomyConfig.level ≥ 2` **and** category not paused **and** no health flag |
| PROPOSED | REJECTED | human decision only |
| PROPOSED | EXPIRED | `expiresAt < now`, sweep job only |
| APPROVED | EXECUTED | executor success; must write `undoData` if `reversible` |
| APPROVED | FAILED | executor error; `error` set |
| EXECUTED | UNDONE | `reversible` **and** `now − executedAt ≤ undoWindowMinutes` |
| anything else | — | **rejected by the write API** — no other transitions exist |

Rules:

- **Only `PROPOSED` can be decided.** Edit-then-approve = `APPROVED` + `editedPayload` set +
  `wasEdited: true`. The edit "diff" is the pair (`payload`, `editedPayload`) — computed at
  read time for graduation stats, not stored redundantly.
- **Auto-approval** (level ≥ 2): `decidedBy = null`, event `approved` with `data: { auto: true }`.
  Level 3 (autonomous) differs from level 2 only in surfacing: level 2 shows in the undo tray,
  level 3 only in the history.
- **FAILED is terminal.** A retry is a fresh `PROPOSED` row (fresh event trail); nothing rewinds.
- **Every transition emits an AgentEvent** (§1). One code path — S7's write API — owns both.

### Graduation-math inputs (what S15 computes — recorded here so the fields exist from day one)

Per category, over `AutonomyConfig.graduationWindowDays`:

- eligible set: actions with `status ∈ {APPROVED, EXECUTED, UNDONE}` and
  `autonomyLevelAtProposal == 1` (only human-reviewed drafts count toward earning level 2)
- **unedited-rate** = share with `wasEdited == false` → graduate when
  `≥ graduationUneditedPct` and sample `≥ breakerMinSample`
- **edit-rate** (breaker input) = share with `wasEdited == true` over the trailing window,
  any level → demote when `≥ editRateThresholdPct`
- **negative-signal rate** (breaker input) = module-supplied (e.g. Huginn: negative replies /
  sends) → demote when `≥ negativeSignalThresholdPct`
- rejection counts and time-to-decision come free from the event stream

`autonomyLevelAtProposal` is what makes these stats trustworthy: a category's history remains
interpretable after its level changes.

---

## 3. AutonomyConfig — per-tenant × per-category level (D2)

One row per category (not a singleton like `OutreachConfig` — categories graduate
independently). Per-tenant is implicit: the table lives in the tenant DB.

### Model draft

```prisma
model AutonomyConfig {
  id       String @id @default(auto()) @map("_id") @db.ObjectId
  category String @unique // dotted key, e.g. huginn.support_reply
  label    String // French label — config-as-data, StageDefinition pattern
  level    Int    @default(0) // 0 off | 1 draft_approve | 2 auto_with_undo | 3 autonomous
  maxLevel Int    @default(3) // ceiling; never-graduates categories seeded with 1

  // graduation + breaker thresholds (OutreachConfig pattern)
  editRateThresholdPct       Int @default(20) // trailing edit-rate that trips demotion
  negativeSignalThresholdPct Int @default(5)  // module-defined negative signal (bounce pattern)
  breakerMinSample           Int @default(10) // below this, breaker/graduation stay silent
  graduationWindowDays       Int @default(21)
  graduationUneditedPct      Int @default(95) // D2: ≥95% unedited over the window

  undoWindowMinutes Int @default(60)

  // kill switch (OutreachConfig paused-triple)
  paused       Boolean   @default(false)
  pausedReason String?
  pausedAt     DateTime?

  updatedAt DateTime @updatedAt
}
```

### Levels (D2 ramp, verbatim)

| Level | Name | Behavior |
|---|---|---|
| 0 | `off` | module never proposes in this category |
| 1 | `draft_approve` | every proposal waits in the inbox (MVP launches everything enabled at 1) |
| 2 | `auto_with_undo` | auto-approved + executed; visible in undo tray for `undoWindowMinutes` |
| 3 | `autonomous` | auto; history-only surfacing |

Level changes — graduation, breaker demotion, manual override — always emit
`heimdallr.<category>.level_changed` with `data: { from, to, cause }`.

### Never-graduates enforcement (defense in depth)

1. **Seed:** money/legal categories ship with `maxLevel: 1` — config UI can't raise past it.
2. **State machine floor (S7, hardcoded):** any action whose content the health classifier
   flagged (D3/S11) is never auto-approved, *regardless of level or config*. Config can't lift
   this — deliberately code, not config, because it must survive any tenant misconfiguration.

### Seed categories (`default-config.ts`, upsert by `category`)

| Category | Label (FR) | maxLevel | Notes |
|---|---|---|---|
| `huginn.support_reply` | Réponses support | 3 | the D2 flagship; starts at level 1 when enabled |
| `muninn.rca_doc` | Documents d'analyse | 3 | |
| `bragi.content` | Contenu marketing | 3 | |
| `crm.field_update` | Mises à jour CRM | 3 | reversible by construction |
| `crm.task_create` | Création de tâches | 3 | |
| `finance.commitment` | Engagements financiers | **1** | never graduates (money) |
| `legal.communication` | Communications juridiques | **1** | never graduates (legal) |

All seeded at `level: 0` (everything off); Huginn categories set to 1 when the tenant enables
the module — per roadmap S3 exit criteria.

---

## 4. PromptTemplate — prompts are tenant config, not source (Path C rule 1)

A broker-specific phrase in a `.ts` file is a rule-#1 violation. Prompt packs are sellable
vertical assets seeded per tenant — the S1 follow-up (customer name hardcoded in
`ai-extract.ts` / `email-research.ts`) migrates onto this model.

### Model draft

```prisma
model PromptTemplate {
  id        String   @id @default(auto()) @map("_id") @db.ObjectId
  key       String   // dotted, e.g. huginn.support_reply.draft
  version   Int      @default(1)
  label     String   // French label
  body      String   // template text with {{placeholders}}
  variables String[] @default([]) // declared placeholder names — render fails on undeclared vars
  taskClass String   // classify | extract | draft | summarize — S5 router maps class → model
  module    String?  // owning module, for admin UI grouping
  active    Boolean  @default(true) // exactly one active version per key (enforced in code, S7 API)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([key, version])
  @@index([key, active])
}
```

### Rules

- **Versions are immutable once used.** Editing a prompt = insert version n+1, flip `active`.
  `AgentAction.promptKey/promptVersion` pins exactly which template produced a proposal —
  audit trail + regression debugging when a prompt change degrades draft quality.
- **`taskClass`, not model names.** Templates declare *what kind* of task they are; the S5
  router owns class → provider/model mapping. A model swap never touches tenant config.
- Rendering validates that supplied variables ⊇ `variables` and rejects undeclared
  placeholders in `body` — Zod at the boundary (bug rule 5), designed here, built at S7/S11.

---

## 5. What S3 does with this doc

1. Add the four models above, verbatim, to `prisma/tenant/schema.prisma` (additive-only).
2. `db:push` **against the mimir-dev cluster only** (run `mimir-env-guard` first).
3. Extend `seedTenantConfig()` with the §3 seed categories (all `level: 0`) and an initial
   prompt-pack skeleton (keys only where prompts already exist in code — the ai-extract /
   email-research migration is its own small session).
4. Seed stays idempotent: upsert by `category` / `key_version`.

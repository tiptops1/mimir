# Mimir — Odin: orchestration layer (S20 design)

> Designed 2026-07-19 (S20). This doc is the reviewed artifact; **S21 implements
> these decisions verbatim** (`prisma/tenant/schema.prisma` additive model,
> `src/lib/odin/*`, `src/lib/jobs/odin-review.ts` or plain function, `/api/cron/odin`,
> `heimdallr-action-row.tsx` type branch, Nornir card). Companion to the Phase 0
> checkpoint entry (`decisions.md` 2026-07-17, Odin approved as Phase 5) and the
> 2026-07-19 MetaGPT/AutoGen rejection (native TS on Inngest + Heimdallr, inherited
> unchanged here). Same tier as `events.md` (S2) — a schema that can't be
> backfilled, over-thought once rather than iterated live.

---

## 0. What Odin is, and isn't

Odin is a top-level agent that **sets objectives** and cascades **directives** down
to the existing module agents (Huginn, Muninn, Bragi, Forseti today; Customer
Success/Legal/HR and Freyja later). It is not a second approval system and not a
second autonomy model:

- **Every decision at every level still flows through the Heimdallr ledger.** Odin
  proposing a directive is an `AgentAction` like every other module's proposal — see
  §3.
- **Per-category `AutonomyConfig` still governs execution rights**, unchanged. Odin
  sets objectives; it never grants itself or any module a new way to act without
  going through the ledger (§4).
- **No new orchestration runtime.** Native TypeScript, Inngest where a job already
  needs it, the same `PrismaClient`-first library convention as every module
  (`heimdallr/ledger.ts`, `lib/ai/meter.ts`) — no MetaGPT/AutoGen, per
  `decisions.md` 2026-07-19.

---

## 1. Hierarchy: 2-tier now, not 4 literal org levels

The Phase 0 checkpoint framed Odin as CEO → Directors → Managers → Employees. That
framing is kept as **documented future elaboration**, not built at S20/S21: with
seven realms and no real customer yet, hardcoding four org tiers is speculative
structure with nothing real to direct — the same reason Odin itself was deferred
past Phase 4 instead of being pulled forward.

**Ship as Odin → module agents** (one tier of orchestration, one tier of
execution). `OdinDirective.scope` (§2) is an open string key — a module name or an
`AutonomyConfig` category — not a hardcoded enum of org levels. If a genuine
intermediate tier (a "Director" agent that owns several modules) is ever needed,
it's an additive `scope` value and a new consuming layer, not a schema change.

---

## 2. `OdinDirective` — a new tenant model, versioned like `RcaDocument`/`ContentPiece`

Same versioned-artifact shape already used twice (Muninn's `RcaDocument`, S16;
Bragi's `ContentPiece`/`BrandVoice`, S18): approving a new version supersedes the
prior ACTIVE row for the same key, in the same transaction as the write; undo
restores the prior version.

```prisma
model OdinDirective {
  id             String    @id @default(auto()) @map("_id") @db.ObjectId
  key            String    // stable scope key: "tenant" (global) | a module name | an AutonomyConfig category
  version        Int       @default(1)
  scope          String    // "tenant" | "module" | "category"
  module         String?   // set when scope != "tenant"
  category       String?   // set when scope == "category"
  objective      String    // human/LLM-readable objective statement (French, tenant data)
  constraints    Json?     // structured guardrails module code can read (topic focus, priorities, limits)
  mode           String    // "standing" (module reads it every run) | "dispatch" (one-shot job trigger)
  status         String    @default("ACTIVE") // ACTIVE | SUPERSEDED | RETIRED
  sourceActionId String?   @db.ObjectId // loose ref -> the AgentAction that approved it
  dispatchedAt   DateTime? // set once a "dispatch"-mode directive has fired its job
  createdAt      DateTime  @default(now())

  @@unique([key, version])
  @@index([key, status])
  @@index([module, status])
}
```

### Rules

- **Versions are immutable once issued** (same discipline as `PromptTemplate`,
  `RcaDocument`, `ContentPiece`). Approving a new directive for the same `key`
  inserts version n+1 and flips the prior ACTIVE row to SUPERSEDED, in the
  executor's transaction (§3) — not two separate writes.
- **`mode: "standing"`** — the target module's job reads the active directive for
  its `module`/`category` key at the start of its run and folds `constraints` into
  its own parameters (e.g. Bragi's `ContentSlot.topic`/`brief` override, §7). No
  Inngest event fires for a standing directive by itself; it's read, not dispatched.
- **`mode: "dispatch"`** — a one-shot instruction ("generate a post about X today").
  Odin's own executor (§3) sends the same Inngest event a manual `/api/<module>/scan`
  route would (`inngest.send({name, data: {tenantId, ...}})`), then stamps
  `dispatchedAt`. A dispatch directive is naturally terminal once dispatched — it
  doesn't need a status beyond ACTIVE→SUPERSEDED/RETIRED, `dispatchedAt` alone
  records whether it fired.
- **`RETIRED`** exists for a directive a human explicitly cancels without replacing
  it (distinct from SUPERSEDED, which always has a successor version).

---

## 3. Directive-setting is itself ledger-gated — no exception for Odin

Odin does **not** write `OdinDirective` rows directly. Its review step (§5) calls
`proposeAction` (`src/lib/heimdallr/ledger.ts`, unchanged — no new ledger API is
needed, it already takes `module`/`category`/`type` as plain strings):

- `module: "odin"`
- `category: "odin.directive"` (new autonomy category, §4)
- `type: "directive.set"`
- `payload`: the draft `{ key, scope, module?, category?, objective, constraints?, mode }`

A human approves in the Heimdallr inbox exactly like every other module's proposal
— `heimdallr-action-row.tsx` gains an `odin.directive_set` type branch (same pattern
as S15's `email.draft_reply`, S16's `doc.rca_draft`, S18's `content.draft`: a
readable rendering of the objective/constraints, edit-then-approve on the objective
text). Approval's executor (`src/lib/odin/executor.ts`, same shape as
`src/lib/bragi/executor.ts`) then:

1. Looks up the current ACTIVE `OdinDirective` for `key` (if any).
2. Creates the new version, flips the prior one to SUPERSEDED, in one transaction.
3. If `mode: "dispatch"`, sends the target module's Inngest event and stamps
   `dispatchedAt`.
4. Calls `executeAction(prisma, action.id, { undoData })` with
   `{ newDirectiveId, previousActiveId }` — undo flips the new row to UNDONE-equivalent
   (RETIRED) and restores the previous ACTIVE row, mirroring
   `revertContentPiece`.

This is the concrete meaning of "every decision at every level flows through the
ledger": the hierarchy's own objective-setting is not privileged over a module's
draft — it goes through the identical PROPOSED → APPROVED → EXECUTED → UNDONE
machinery, reversible, auditable, autonomy-gated.

---

## 4. `odin.directive` is a new autonomy category, not a reuse

Forseti (S19) deliberately reuses `crm.task_create` rather than inventing its own
category, because a compliance follow-up *is* a task creation — no new action type
exists there. Setting a business objective is different: it's a genuinely new kind
of decision, so it earns its own seeded category
(`src/lib/default-config.ts`, `DEFAULT_AUTONOMY_CATEGORIES`):

```
{ category: "odin.directive", label: "Directives Odin", maxLevel: 3 }
```

Seeded at `level: 0` like every other category — a tenant turns it on explicitly,
same posture as Huginn/Bragi.

**No new never-graduates floor is needed.** A directive is only ever an
*objective* — it carries no execution rights of its own. `finance.commitment` and
`legal.communication` stay individually gated at `maxLevel: 1` regardless of what
any directive's `constraints` say; a graduated `odin.directive` category only means
Odin's *objective-setting* can auto-approve, never that a downstream module's
money/legal action skips its own gate. This objectives-vs-execution-rights
separation is what keeps D2 (graduated autonomy, circuit breaker, never-graduates)
fully intact underneath Odin, and it is stated explicitly here so S21 — and anyone
reviewing the ledger later — doesn't have to re-derive it from the code.

---

## 5. Odin's own reasoning loop: daily cron, no Inngest, Sonnet-tier

Odin's review is a single LLM synthesis over aggregates that already exist — it is
not a multi-step pipeline needing Inngest's resumability, so it follows Forseti's
shape (plain cron route, direct function call), not Huginn/Bragi's (Inngest
scan+draft fan-out):

- **Trigger:** `/api/cron/odin/route.ts` (daily, `authorized()` + `?tenant=` slug
  lookup via `controlPrisma`, same shape as `/api/cron/forseti/route.ts`) calls
  `reviewAndProposeDirective(prisma)` directly — no Inngest event, no job function.
- **Inputs read** (all already implemented, no new query needed beyond §7's
  addition): `getPilotStats` (`src/lib/nornir/queries.ts`), `usageSnapshot`/
  `checkBudget` (`src/lib/ai/meter.ts`), `countPendingActions`
  (`src/lib/heimdallr/queries.ts`), `AutonomyConfig` rows (levels, breaker state),
  recent `AgentEvent` activity.
- **Model:** `taskClass: "draft"` (Sonnet, per the roadmap §0 runtime table — a
  business-consequential decision, not classification/extraction). New
  `PromptTemplate` key `odin.review.propose_directive`, tenant config like every
  other prompt.
- **Output:** zero or one `proposeAction` call (§3) per run — the review can
  legitimately decide nothing needs to change and propose nothing. Fail-closed like
  every other module: unparseable/budget-exhausted output means no proposal, never
  a guessed directive.

---

## 6. Event taxonomy additions (`events.md` vocabulary extension)

No new doc structure — this extends `events.md` §1's tables:

- **`module`**: add `odin`.
- **`category`**: `odin.directive` for the actionable path (the autonomy category,
  §4) — reuses every existing lifecycle verb (`proposed`/`approved`/`edited`/
  `executed`/`undone`, no new verbs needed there). A module-local `review` domain
  for non-actionable telemetry (mirrors `mimisbrunnr`'s `ingestion`/`retrieval`
  local categories, e.g. "review ran, nothing proposed").
- **New verb**: `directive_dispatched` — emitted when a `mode: "dispatch"`
  directive's executor sends its target module's Inngest event (§3 step 3),
  `data: { targetModule, targetEvent }`.

---

## 7. Surfacing — reuse, don't build a new dashboard

- **Approval**: through the existing Heimdallr inbox only (§3's type branch). No
  new route for Odin's own proposals.
- **Read-only visibility**: a "Objectifs actifs" card added to the *existing*
  Nornir page — `src/lib/nornir/queries.ts` gains `listActiveDirectives(prisma)`
  (same `PrismaClient`-first, read-only convention as `getPilotStats`/
  `listRecentAgentEvents`). Explicitly **not** a new dashboard engine or a new
  route — S17 already committed Nornir as the one place "whole company at a glance"
  lives.
- Both of these are **S21 implementation**, not built in this design session.

---

## 8. Directive consumption order (S21 punch list)

Not every module gains directive-reading at once. Priority, and why:

1. **Bragi first.** Richest existing config-driven surface — `ContentSlot.topic`/
   `brief` already exist as per-slot overridable fields; a `mode: "standing"`
   directive scoped to `bragi.content` folds naturally into the same
   `renderBrandVoiceBlock`-style prompt-variable injection Bragi already does for
   `BrandVoice`. Also the clearest `mode: "dispatch"` case ("generate a post about
   X today" → `bragi/content.generate.requested` with a topic override).
2. **Huginn second.** Lower-value but plausible: a standing directive could bias
   tone/category-priority in support replies. Deferred past Bragi because Huginn's
   trigger is an inbox sweep, not a config-driven calendar — there's less for a
   directive to override cleanly.
3. **Muninn and Forseti explicitly deferred, not scoped for S21.** RCA docs are
   reactive-per-incident (an objective doesn't change what already happened);
   Forseti's compliance detection is factual, not objective-driven (ORIAS/RC Pro
   expiry dates aren't things a directive should be able to reinterpret). Revisit
   only if a real tenant surfaces a concrete need.

## 9. What S21 does with this doc

1. Add `OdinDirective` (§2) verbatim, additive, to `prisma/tenant/schema.prisma`.
   `db:push` against `mimir-dev` only (`mimir-env-guard` first).
2. Seed the `odin.directive` category (§4) in `DEFAULT_AUTONOMY_CATEGORIES` +
   the `odin.review.propose_directive` `PromptTemplate` skeleton (§5).
3. `src/lib/odin/draft.ts` (pure: builds the review input, calls the model, parses
   fail-closed) + `src/lib/odin/executor.ts` (§3: version-supersede + optional
   dispatch + `executeAction`/undo, mirroring `bragi/executor.ts`).
4. `/api/cron/odin/route.ts` (§5) — plain function call, no Inngest job.
5. `heimdallr-action-row.tsx` gains the `odin.directive_set` type branch (§3).
6. `src/lib/nornir/queries.ts` gains `listActiveDirectives`; Nornir page gains the
   "Objectifs actifs" card (§7).
7. Bragi's job (`src/lib/jobs/bragi-generate.ts`, `src/lib/bragi/draft.ts`) gains
   `mode: "standing"` directive reads for `bragi.content` (§8, first consumer).
   Huginn is the next follow-up, not this session's exit criteria.

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

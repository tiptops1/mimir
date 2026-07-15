# Mimir — decisions log

> Companion to `roadmap.md` and `AGENTIC-PLATFORM-DECISION-MEMO.md`. One entry per closed decision,
> newest last. When this file and the memo disagree, this file wins (it's more recent by
> construction).

## 2026-07-15 — S0: environment split executed (D6 mechanics)

**Duplication mechanic: full-history `git clone` of `avelior-analytics` @ `719f842`, origin swapped
to `tiptops1/mimir`.**

Why clone over squash/fresh-init:
- Shared git history keeps `git cherry-pick <sha>` the tool for pulling Vision RM bug fixes across
  (§0.5 baseline discipline explicitly plans for this). A squashed baseline would demote fix-porting
  to manual patch application.
- The baseline must be a *faithful* copy of the working system (control/tenant Prisma split, DB
  router, AES-256-GCM encryption, jose auth) — clone guarantees byte-fidelity at the chosen commit.

Accepted caveat, recorded consciously: the inherited history contains Christopher's prospect CSVs
(`data/crm-chris-*.csv`, deleted from the working tree in the first Mimir commit) and a committed
21 MB Prisma query-engine DLL under `src/generated/control/`. Both remain reachable in git history.
Acceptable because the repo is private and owned by the same builder who already holds that data.
If the repo ever gains collaborators or goes public, rewrite history first (`git filter-repo`).

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
  not a product Mimir maintains for Vision RM's users. Christopher stays on `avelior-analytics`.

## 2026-07-15 — S0b: baseline strip-down executed

Ran the `docs/mimir/strip-list.md` punch list end to end. Runtime: the tenant-#1 IMAP/ICS/
`FIREFLIES_API_KEY` fallback branches in `tenant-cron.ts` and both `/api/cron` routes are gone —
email/calendar sync now runs only when a tenant has connected Google OAuth; Fireflies only via the
per-tenant `Integration` key. Deleted `imap-sync.ts` and `resolveTenant1Google()`; trimmed
`calendar-sync.ts` down to its shared `processCalendar` matching engine (still used by the OAuth
path) and dropped the legacy ICS-fetch function. Deleted five CLI scripts that only existed to
drive the retired path (`sync-email/calendar/all/fireflies.ts`, `clean-inbox-spam.ts`) + their
`package.json` aliases. Christopher-specific config (`CHRISTOPHER_CONFIG` → `DEFAULT_CONFIG`),
the dead CSV `prisma/seed.ts`, and `bootstrap-control-plane.ts` are gone; `add-user.ts` and the
outreach unsubscribe test script now default to `crm_demo`. Real `@avelior.eu`/`@get-avelior.com`
addresses in test fixtures and one UI example string are now `example.com`/generic. `.env.example`
lost `TENANT1_SLUG`, the legacy IMAP/ICS/`FIREFLIES_API_KEY` blocks, and the commented `SEED_ADMIN_*`
block. The repo-hygiene and `GOOGLE_CSE_*`/`TENANT` strip-list items were already non-issues
(verified, not tracked in git / not present in code). Docs drift is untouched — explicitly S1.
`npm run lint` + `npm run build` green; `grep -ri crm-railway` and
`grep -rE "avelior\.eu|get-avelior\.com"` repo-wide now only hit docs (S1 scope).

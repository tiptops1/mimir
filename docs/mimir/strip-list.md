# S0b strip-list — tenant-#1 / prod-specific baggage in the baseline

> Produced at S0 (2026-07-15) from a full audit of the codebase at `719f842`. This is the input for
> **S0b — Baseline strip-down** (Sonnet session). Strip or neutralize each item; exit = lint/build
> green + `grep -ri crm-railway` returns nothing repo-wide.
>
> Already removed in the S0 detach commit (not S0b work): `data/crm-chris-*.csv` (client data),
> `.github/workflows/leadone.yml` (daily GH Action writing to the prod tenant DB via repo secrets).

## Legacy tenant-#1 runtime fallbacks (`isTenant1` branches)

| Where | What |
|---|---|
| `src/lib/tenant-cron.ts` (~line 23) | `tenant1Slug()` helper + IMAP/iCal/Fireflies env fallbacks when tenant #1 has no OAuth connection |
| `src/app/api/cron/route.ts` (~18, 66) | same slug gate + `FIREFLIES_API_KEY` env fallback |
| `src/app/api/cron/advance/route.ts` (~14) | same slug gate; digest greeting special case |
| `src/lib/google-oauth.ts` (~142) | `resolveTenant1Google()` — resolves tenant #1 by `TENANT1_SLUG` |
| `src/lib/imap-sync.ts` | whole legacy IMAP path (`IMAP_HOST/PORT/USER/PASSWORD`, `OWNER_EMAIL`) |
| `src/lib/calendar-sync.ts` (~150) | legacy iCal path (`GOOGLE_CALENDAR_ICS_URL`, `OWNER_EMAIL`) |
| `src/lib/fireflies.ts` (~107) | env-key fallback (`FIREFLIES_API_KEY`, `OWNER_EMAIL`) |

In Mimir these are dead on day one: `TENANT1_SLUG=crm_demo` and none of the legacy env vars are
set, so the branches no-op — but they're noise and a foot-gun. Decide per item: delete the legacy
path (preferred) or leave the per-tenant OAuth path as the only path.

## Christopher-specific config & data

- `src/lib/tenant-config.ts` — `CHRISTOPHER_CONFIG` constant; `getTenantConfig()` returns it for
  every tenant. Replace with per-tenant config (Setting/FieldDefinition pattern) or a neutral default.
- `prisma/seed.ts` — CSV importer for Christopher's real book (maps French stage labels). Source
  CSVs already deleted; the script is dead. Delete or rewrite as a synthetic-data seeder (S6 wants
  one anyway).
- `scripts/bootstrap-control-plane.ts` — Phase-0 "promote Christopher's existing DB in place"
  script; meaningless in an environment with no pre-existing data. Delete.
- `scripts/add-user.ts` — default `--tenant crm_chris`; change default to `crm_demo` or require the flag.
- Outreach test scripts with real addresses: `scripts/test-outreach-unsubscribe.ts`,
  `scripts/test-outreach-engine.ts`, `scripts/test-outreach-replies.ts` (`@avelior.eu`,
  `@get-avelior.com` message-IDs/emails). Neutralize to example.com fixtures.
- `src/components/connect-outreach-cta.tsx` — example address `chris@get-avelior.com`.

## Dead env vars (never set in Mimir; remove from `.env.example` at S0b)

`GOOGLE_CSE_KEY`, `GOOGLE_CSE_CX` (CSE replaced by Tavily+Exa), `SEED_ADMIN_EMAIL/PASSWORD/NAME`
(admin accounts live in the control plane now), `TENANT`, plus the whole legacy block:
`IMAP_HOST/PORT/USER/PASSWORD`, `OWNER_EMAIL`, `GOOGLE_CALENDAR_ICS_URL`, env-level
`FIREFLIES_API_KEY`.

## Docs drift (S1's job, listed for completeness — do NOT do at S0b)

- `CLAUDE.md`, `README.md`, `INTEGRATIONS.md`, `docs/architecture.md`, `docs/roadmap.md`,
  `docs/product-roadmap.md` all describe Vision RM prod ("don't break the live app", Railway
  references, Christopher as live user). S1 rewrites CLAUDE.md and prunes; keep
  `docs/VISION-RM-BRIEF.md` as the baseline reference.

## Repo hygiene (opportunistic, low priority)

- `src/generated/control/` is committed (incl. 21 MB engine DLL) and regenerated on every
  `postinstall` — candidate for gitignoring + one removal commit.
- `tsconfig.tsbuildinfo` committed at top level; gitignore candidate.

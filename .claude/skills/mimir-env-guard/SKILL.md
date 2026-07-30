---
name: mimir-env-guard
description: Environment pre-flight for the mimir repo — confirm this shell's .env is the environment the command intends before running any script, db:push, or ship. Mimir now has a production environment with a paying customer's data, plus the legacy Vision RM prod cluster. Use before every data-touching command, and whenever .env changes.
---

# Mimir environment guard

Until S28 this repo had no production environment, so the check was simply "is anything pointing
at the Vision RM prod cluster (`crm-railway`)". That is no longer the whole question.

**There are now three clusters you can hit by accident:**

| Cluster | What it is | May a dev shell touch it? |
|---|---|---|
| `crm-railway` | Vision RM baseline production (legacy name) | **Never.** Different repo, different product. |
| `mimir-dev` | Mimir development/demo (M0) | Yes — this is the default. |
| Mimir production | The Chronos customer's real inventory and money (M0, own Atlas project) | Only from a shell that declares `MIMIR_ENV=prod`, and only for operations that accept `--prod`. |

So the question this skill answers is no longer "does prod exist" but:

> **Is this shell's `.env` the environment the command intends?**

## The check

```bash
npm run env:check
```

That is the primary check. It prints the resolved environment, every DB **hostname** (never
credentials), which required variables are present, and whether the DB URLs agree with each other.
It exits non-zero on any FAIL.

Then the one thing `env:check` cannot know — that the *legacy baseline* cluster must never appear
here at all:

```bash
grep -rli "crm-railway" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git --exclude-dir=backups . \
  && echo "FAIL: Vision RM prod host referenced in this repo" || echo "OK: no baseline prod host"
```

## Reading the result

- **`Environment: DEV`, one consistent host, no FAIL** → normal. Proceed.
- **`Environment: PROD`** → stop and think. You are one command away from a paying customer's
  data. Prod-capable scripts require `--prod`; demo seeders will refuse outright and cannot be
  overridden. If you did not *intend* prod, your `.env` is wrong — fix it before anything else.
- **`FAIL DB host agreement`** → `CONTROL_DATABASE_URL` / `CLUSTER_BASE_URL` / `DATABASE_URL`
  resolve to different clusters. This is a half-edited `.env`, the state in which a script writes
  into one environment's control plane and another's tenant data. Never run anything until fixed.
- **Any `crm-railway` hit** → the baseline's production cluster has leaked into this repo. Stop.

## Rules

- Any FAIL stops the session's data-touching work. Do not "just this once."
- Hostnames only in any output — never `.env` values, never credentials.
- `--dry` first for any script that writes.
- Run before: `npm run db:push`, `db:push:control`, `db:push:tenant`, `tenant:provision`,
  `backup:dump`, any writing `npx tsx scripts/...`, and as step 1 of `mimir-ship`.
- **Never edit `.env` to point at production "just to check something."** If you need to inspect
  prod, use a read-only path and the runbook. Rewriting `.env` mid-session is how both of the
  accidents this guard exists to prevent actually happen.

Full context, including what each in-code guard refuses and why: `docs/mimir/ops.md`.

---
name: chronos-ship
description: Ship the Chronos platform — lint, build, commit, push to the Chronos Vercel project, db:push against the Chronos cluster only if prisma/ changed, tick the roadmap. Use when the user says "push", "ship it", or "deploy" while working in this repo. Only for this repo.
---

# Chronos ship ritual

Run this exact sequence from inside the `mimir/` repo, only after the user explicitly says "push"
(or equivalent). Once they say it, run the whole chain without asking turn-by-turn.

## Pre-flight (mandatory)

1. Run the `chronos-env-guard` skill's check first (`npm run env:check` + the `crm-railway` grep).
   If it fails, STOP — do not push, do not db:push.
2. Confirm you are in `mimir/` (`git remote get-url origin` → `tiptops1/mimir`), not
   `chronos`.
3. **Confirm which environment your `.env` is.** The chain's schema-push steps write to whatever
   it points at. A dev `.env` (the default) is what you want for an ordinary ship.

## The chain

```bash
npm run lint
npm run test
npm run build          # runs prisma:generate for both schemas first
git add -A && git commit -m "..."
git push               # Vercel auto-deploys from main
npm run db:push          # ONLY if prisma/tenant/schema.prisma changed
npm run db:push:control  # ONLY if prisma/control/schema.prisma changed
```

## Two environments now deploy from `main`

Since S28 there is a Chronos **production** Vercel project (the Chronos customer) alongside dev.
Both track `main`, so one `git push` deploys both. Consequences for this chain:

- A tenant-schema change must be **additive**, or both environments break at once.
- The `db:push` steps above only touch the environment your `.env` names. Production tenants are
  migrated separately and deliberately:
  `npm run db:push:tenant -- --slug <slug> --prod` (one command per prod tenant, by design).
  `npm run db:push` itself is refused under `MIMIR_ENV=prod`.
- If `prisma/` changed, say so explicitly in the report: production is not migrated by pushing.

Windows note: stop the dev server before `prisma generate`/`npm run build` — a running node
process holds the query-engine DLL and causes EPERM rename failures (OneDrive makes it worse).

## After the push

1. Tick the session's checkbox in `docs/chronos/roadmap.md` (the roadmap is the cross-session
   memory — an unticked box means the work didn't happen).
2. If a decision was closed this session, append it to `docs/chronos/decisions.md`.

## Never

- Never run this chain against `chronos` or with a `.env` pointing at `crm-railway`.
- Never push without the literal user "push" — mid-session commits are fine, pushes are not.
- Never run the chain's `db:push` steps from a `MIMIR_ENV=prod` shell. Production schema rollout
  is a separate, per-tenant, explicitly-flagged operation — see `docs/chronos/ops.md` §6.

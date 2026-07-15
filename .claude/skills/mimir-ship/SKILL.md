---
name: mimir-ship
description: Ship the Mimir platform — lint, build, commit, push to the Mimir Vercel project, db:push against the Mimir cluster only if prisma/ changed, tick the roadmap. Use when the user says "push", "ship it", or "deploy" while working in the mimir repo. Never use for avelior-analytics (that's /ship).
---

# Mimir ship ritual

Run this exact sequence from inside the `mimir/` repo, only after the user explicitly says "push"
(or equivalent). Once they say it, run the whole chain without asking turn-by-turn.

## Pre-flight (mandatory)

1. Run the `mimir-env-guard` skill's check first: `.env` and the repo must not reference the prod
   cluster host (`crm-railway`). If the guard fails, STOP — do not push, do not db:push.
2. Confirm you are in `mimir/` (`git remote get-url origin` → `tiptops1/mimir`), not
   `avelior-analytics`.

## The chain

```bash
npm run lint
npm run build          # runs prisma:generate for both schemas first
git add -A && git commit -m "..."
git push               # Vercel auto-deploys from main
npm run db:push          # ONLY if prisma/tenant/schema.prisma changed
npm run db:push:control  # ONLY if prisma/control/schema.prisma changed
```

Windows note: stop the dev server before `prisma generate`/`npm run build` — a running node
process holds the query-engine DLL and causes EPERM rename failures (OneDrive makes it worse).

## After the push

1. Tick the session's checkbox in `docs/mimir/roadmap.md` (the roadmap is the cross-session
   memory — an unticked box means the work didn't happen).
2. If a decision was closed this session, append it to `docs/mimir/decisions.md`.

## Never

- Never run this chain against `avelior-analytics` or with a `.env` pointing at `crm-railway`.
- Never push without the literal user "push" — mid-session commits are fine, pushes are not.

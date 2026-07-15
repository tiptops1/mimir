---
name: mimir-verify
description: Verify a Mimir change in the browser — start the mimir-dev server on port 3001, log in past the auth wall as the crm_demo admin, and check the changed surface. Use when a UI change in the mimir repo needs visual verification.
---

# Verify a Mimir change in the browser

## Start the server

Use the Browser pane's `preview_start` with `{name: "mimir-dev"}` (defined in `.claude/launch.json`,
port **3001** — avelior-dev owns 3000; both can run side by side).

## Get past the auth wall

The app redirects everything to `/login` without a session (see `src/proxy.ts` + `src/lib/dal.ts`).

- Demo credentials: email `nt.nicolas.toppo@gmail.com`, password = the value the user stored for
  the `crm_demo` admin (ask the user if unknown — it is NOT in `.env` or this skill).
- Log in via the form at `http://localhost:3001/login` (email + password fields, submit). On
  success you land on `/dashboard`.
- The session cookie (`session`, httpOnly, 7-day) persists across reloads in the same browser tab —
  log in once per session.

## Verify

1. Navigate to the changed surface, `read_page` for structure/text, screenshot for visual proof.
2. Check `read_console_messages` (onlyErrors) and `preview_logs` for server errors.
3. Dark mode / responsive via `resize_window` only when the change touches layout or theming.

## Rules

- This environment has NO production user — but it must point at the Mimir Atlas cluster only.
  If anything looks like prod data (French broker companies you didn't seed), STOP and check `.env`.
- Don't start the dev server for non-UI sessions (token rule 6 in `docs/mimir/roadmap.md`).

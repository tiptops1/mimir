---
name: mimir-env-guard
description: Isolation pre-flight for the mimir repo — verify nothing points at the Vision RM production cluster before running any script, db:push, or ship. Use before every data-touching command in mimir, and whenever .env changes. The highest-severity mistake available in this repo is pointing at prod.
---

# Mimir environment guard

Mimir's bug rule #4 (`docs/mimir/roadmap.md` §4): *"The highest-severity mistake available in this
repo is an `.env` or script pointing at the prod cluster."* This skill is the check.

The Vision RM production cluster's hostname contains **`crm-railway`** (legacy name, still the prod
cluster). The Mimir cluster is a different Atlas project entirely (cluster `mimir-dev`).

## The check (run all three, in order)

```bash
# 1. .env must not reference the prod cluster (checks names+hosts only, never prints values)
grep -ci "crm-railway" .env && echo "FAIL: .env points at PROD" || echo "OK: .env clean"

# 2. Repo-wide: no source/script/doc may carry the prod host (S0b exit criterion)
grep -rli "crm-railway" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git . \
  && echo "FAIL: prod host referenced in repo" || echo "OK: repo clean"

# 3. Positive check: the three DB vars exist and point at ONE non-prod cluster
node -e "require('dotenv').config(); const vars=['DATABASE_URL','CONTROL_DATABASE_URL','CLUSTER_BASE_URL']; const hosts=vars.map(v=>{const m=(process.env[v]||'').match(/@([^/?]+)/); return m&&m[1];}); if(hosts.some(h=>!h)) {console.log('FAIL: missing DB var'); process.exit(1);} if(new Set(hosts).size>1) console.log('WARN: DB vars point at different hosts:', hosts); if(hosts.some(h=>h.includes('crm-railway'))) {console.log('FAIL: PROD HOST'); process.exit(1);} console.log('OK: all DB vars ->', hosts[0]);"
```

## Rules

- Any FAIL → stop the session's data-touching work until resolved. Do not "just this once."
- Never print `.env` values while checking — hostnames only, credentials never.
- Scripts that write data get a `--dry` run first (inherited habit, still correct here).
- Run this before: `npm run db:push`, `db:push:control`, `tenant:provision`, any `npx tsx
  scripts/...` that writes, and as step 1 of `mimir-ship`.

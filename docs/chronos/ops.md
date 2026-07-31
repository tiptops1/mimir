# Chronos — operations runbook

> Written at **S28** (2026-07-30), when the platform stopped being demo-only. Companion to
> `docs/chronos/roadmap.md` §0.5 (the environment model) and `decisions.md` D6 (the isolation
> charter). If you are about to run a command that writes to a database, this is the file.

---

## 1. The environment model

Three independent environments. Nothing is shared between them — not a cluster, not a secret,
not a queue.

| | **CRM baseline (prod)** | **Chronos dev** | **Chronos prod** |
|---|---|---|---|
| Repo | the baseline repo | this repo, `main` | this repo, `main` |
| Atlas | `crm-railway` (legacy name) | project *mimir*, cluster `chronos-dev` (M0, EU) | **its own Atlas project**, own M0 cluster (EU) |
| Control DB | baseline's | `chronos-dev` cluster | prod cluster — never reachable from a dev machine |
| Host | baseline's Vercel project | — (local only) | **its own Vercel project**, own domain |
| Crons | cron-job.org | none | cron-job.org, own `CRON_SECRET` |
| Secrets | baseline `.env` | dev `.env` | Vercel env vars only, all fresh |
| Live user | the baseline's tenant | none — demo tenants | **the Chronos customer** |
| `MIMIR_ENV` | n/a | `dev` (or unset) | **`prod`** |

**The rule that replaced "never point this repo at the prod cluster":**

> A shell's `.env` must match the environment the command intends, and prod work must say `--prod`
> out loud. Demo seeders never run against prod at all.

That is enforced in code, not just here — see §4.

---

## 2. Atlas on the free tier — read this before promising anything

Production runs on **M0 (free)**, knowingly and with the customer informed. The limits are not
footnotes; they change what operating this system means.

- **There are no backups. None.** No snapshots, no point-in-time recovery, no restore button.
  M0 does not have the feature. The *entire* recovery story is `npm run backup:dump` (§5) actually
  being run. If nobody runs it, a dropped collection is gone.
- **One M0 cluster per Atlas *project*.** `chronos-dev` already occupies the free slot in its
  project, so production needs a **new Atlas project**, not just a new cluster in the old one.
  This is also what D6 wanted anyway (separate project = separate access control).
- **512 MB storage.** Chronos inventory is small (thousands of units, tens of thousands of cost
  lines) so this is not near-term binding, but it is not monitored automatically either.
- **3 Atlas Search indexes per cluster.** `chronos-dev` is at 3/3 already. The prod cluster starts
  at 0/3, and `SearchIndexBudget` is a **control-plane singleton**, so each environment counts its
  own — correct by construction, since each control plane sits on its own cluster.
- **No private networking.** Network access must be `0.0.0.0/0` for Vercel to connect. The
  database user's password is therefore the only thing between the internet and the data: make it
  long, and never reuse the dev one.
- **Shared tier, no performance guarantees.** Fine for one tenant; revisit at the second.

**When to upgrade:** the moment storage passes ~70%, the moment a second paying tenant lands, or
the first time losing a day of data would matter more than the monthly fee. Flex adds daily
snapshots; M10 adds continuous PITR and lifts the search-index cap.

---

## 3. Standing up production (do this once, by hand)

### 3.1 Atlas

1. Create a **new Atlas project** (not a cluster in the existing one — see §2).
2. Create an M0 cluster in an **EU region** (Irish customer, EU data residency).
3. Database user: fresh username, long generated password. **Not** the dev credentials.
4. Network Access → `0.0.0.0/0`.
5. Note the cluster host. You need two URIs off it:
   - `CONTROL_DATABASE_URL` → `.../mimir_control?retryWrites=true&w=majority`
   - `CLUSTER_BASE_URL` → `.../?retryWrites=true&w=majority` (no db path; provisioning swaps in
     the tenant slug)

### 3.2 Secrets — all fresh, none copied from dev

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # CRON_SECRET
```

`ENCRYPTION_KEY` especially: it encrypts every tenant connection string and every OAuth refresh
token in the control plane. A prod control row encrypted with the dev key would be a silent
cross-environment dependency. **Prod tenant rows must be created by prod provisioning, never
copied across.**

### 3.3 Vercel

1. New Vercel project, same GitHub repo, production branch `main`.
2. Environment variables — everything in `.env.example`, plus:
   - `MIMIR_ENV=prod` ← **the one that arms every guard in §4**
   - `APP_URL=https://<the real domain>`
   - `NEXT_PUBLIC_BRAND_NAME=Chronos` (build-time inlined; it brands the login page, the
     `<title>` and the manifest, which render outside `(app)` and have no session)
3. Function region: `vercel.json` pins `dub1`. If the plan rejects a `regions` key, set the
   project's function region in the dashboard instead and delete the key.
4. Deploy.

### 3.4 Schema and the first tenant

From a shell whose `.env` points at **prod** (`MIMIR_ENV=prod`), verify first:

```bash
npm run env:check
```

It must print `Environment: PROD`, one consistent DB host, and no FAIL lines. Then:

```bash
npm run db:push:control -- --prod
npm run tenant:provision -- --prod --slug chronos --name "Chronos" \
  --modules chronos --brand "Chronos" --no-vector-index \
  --admin-email <his email> --admin-password "<a strong temporary password>"
```

`--no-vector-index` because Chronos has no knowledge base — it would spend one of the three
search-index slots for nothing. `--modules chronos` withholds the eight French broker stages,
the ~30 broker fields and the broker prompt pack from his tenant.

Then set his real commercial facts (`ChronosConfig`: marketplace fee percentages, VAT scheme and
rate, labour rate, tool overhead, target margin). These are **tenant config, not code**, and the
defaults in `src/lib/default-config.ts` are generic placeholders — eBay 12.8% + 30c, Chrono24
6.5%, VAT margin scheme at 23%. Confirm each against his actual seller statements.

> **Say this to him in writing, once:** the margin figures assume the second-hand **margin
> scheme** and model no input-VAT reclaim on restoration parts. He should confirm the scheme with
> his accountant before trusting the numbers for a VAT return. This is not tax advice.

### 3.5 Crons

cron-job.org, against the prod domain, **using the `Authorization: Bearer $CRON_SECRET` header**.
The `?key=` query form still works in dev but is **refused in production** — it would put the
secret in cron-job.org's stored URL and in Vercel's access logs.

| Route | Cadence |
|---|---|
| `/api/cron` | every 4 h — ingestion (Gmail, Calendar, Fireflies, AI insight, digest) |
| `/api/cron/enrich` | hourly |
| `/api/cron/advance` | every 4 h |
| `/api/cron/outreach` | hourly, Mon–Fri 08:00–18:00 Europe/Paris |
| `/api/cron/forseti` | daily, 03:00 Europe/Paris — compliance snapshot |
| `/api/cron/thor` | daily, 04:00 Europe/Paris — account-health sweep |
| `/api/cron/odin` | daily, 04:00 Europe/Paris — directive review |
| `/api/cron/freyja` | daily, 05:00 Europe/Paris — ad-metrics pull |
| `/api/cron/chronos` | daily, 06:00 Europe/Paris — marketplace order sync (S29) |

All of these loop **every ACTIVE tenant** and need no `?tenant=`. The per-module *trigger* routes
(`/api/{huginn,thor,bragi,freyja}/scan`, `/api/muninn/generate`, `/api/mimisbrunnr/ingest`,
`/api/chronos/sync`, `/api/jobs/proof`) act on one tenant and **require** `?tenant=<slug>` — they
return 400 without it rather than guessing.

### 3.6 Go-live checklist

- [ ] `npm run env:check` clean against prod
- [ ] Login works on the real domain; wordmark and logo are Chronos, not Chronos
- [ ] `/companies` and `/dashboard` redirect (CRM module withheld)
- [ ] `ChronosConfig` carries his real fee percentages and VAT rate
- [ ] Cron entries created with the Bearer header, one test fire each returns 200
- [ ] `mongodump` installed (`winget install MongoDB.DatabaseTools`) — **without it there is no
      backup path whatsoever on M0**
- [ ] `npm run backup:dump -- --slug chronos --prod` succeeds, and a restore has been rehearsed
- [ ] He has changed his temporary password
- [ ] The VAT/margin-scheme caveat has been sent to him in writing

---

## 4. The guards, and what they will refuse

`MIMIR_ENV` declares intent. It is never sniffed from a hostname — a copy-pasted prod URI in a dev
`.env` would identify itself as prod and sail through, which is exactly the accident worth
catching.

| Guard | Where | Behaviour |
|---|---|---|
| `assertProdAllowed()` | provisioning, schema pushes, branding, user add, backfills, enrichment, Lead One, backups | Runs freely in dev. Under `MIMIR_ENV=prod` demands an explicit `--prod` flag and prints the host summary. |
| `refuseInProd()` | every demo seeder, fixture injector, one-off baseline cleanup, debug script | Hard refusal in prod. **No override flag.** |
| host agreement | both of the above, and `env:check` | Refuses when `CONTROL_DATABASE_URL` / `CLUSTER_BASE_URL` / `DATABASE_URL` resolve to different hosts — the half-edited-`.env` state that writes into one environment's control plane and another's tenant data. |
| `npm run db:push` | `scripts/db-push.ts` | Refused outright in prod: it only ever targets `DATABASE_URL`, so with several tenants it pushes to one and silently skips the rest. Use `db:push:tenant -- --slug X --prod`. |
| cron auth | `src/lib/cron-auth.ts` | Timing-safe compare; `?key=` disabled in prod. |

Guards print **hostnames only**, never credentials.

---

## 5. Backups — the part that is manual

```bash
npm run backup:dump -- --slug chronos --prod     # one tenant + the control plane
npm run backup:dump -- --all --prod              # every ACTIVE tenant + control plane
```

Writes `./backups/prod-<timestamp>/` (git-ignored).

> **Prerequisite, and it is not installed yet.** The script needs `mongodump` from the MongoDB
> Database Tools on PATH. Until that is installed, the script exits with instructions and **there
> is no backup path at all** — M0 has no snapshots to fall back on. Install it before the customer
> enters real inventory:
>
> ```bash
> winget install MongoDB.DatabaseTools
> ```

The control plane is always included: it holds every tenant's encrypted connection string and all
logins, and restoring tenant data without it leaves a pile of orphan databases.

**Cadence while on M0: weekly, and before any schema push or data migration.** Keep the last four
weekly dumps somewhere that is not the same laptop.

**Restore drill** — do this once, now, and again whenever the schema changes shape. Restore into a
*scratch* database, never over a live one:

```bash
mongorestore --uri="<scratch cluster URI>" --drop "backups/prod-<timestamp>"
```

Then log in against the scratch environment and confirm units, cost lines and margins render. A
dump nobody has restored is not a backup — it is a file.

---

## 6. Deploying a change

Use the `chronos-ship` skill. It runs lint → test → build → commit → push, and pushes schema only
when `prisma/` changed. Two environment-specific notes:

- Pushing `main` deploys **both** Vercel projects if both track `main`. That is intended (one
  codebase), but it means a schema change must be additive or both environments break at once.
  Additive-only is a standing rule for exactly this reason.
- A tenant-schema change needs `db:push:tenant -- --slug <slug> --prod` per prod tenant. There is
  no "push to all tenants" command, deliberately.

---

## 7. When something is wrong

**Everyone is bounced to `/login`.** Historically this was `SESSION_SECRET` unset — encoding
`undefined` yields a key that signs fine and verifies nothing, with no error anywhere. Since S28
that throws a named error instead, so check the Vercel function logs first.

**Outbound emails link to `localhost`.** `APP_URL` unset. Also throws in prod since S28.

**A cron returns 401.** `CRON_SECRET` mismatch, or the schedule is using `?key=` (refused in
prod). Move it to the `Authorization: Bearer` header.

**A tenant's page 500s on a DB call after a deploy.** The tenant schema was not pushed to that
tenant. `npm run db:push:tenant -- --slug <slug> --prod`.

**A script refuses to run.** Read what it says — it is one of the §4 guards, and it is almost
certainly right. Do not add `--prod` to something whose name contains `demo` or `seed`; that
refusal has no override for a reason.

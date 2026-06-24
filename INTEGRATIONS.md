# Auto-enrichment integrations

Connect Christopher's **Gmail**, **Google Calendar** and **Fireflies** so the CRM
fills itself in: every email, meeting and call transcript is matched to the right
company/contact, logged as an activity, and read by Claude to extract a summary,
sentiment, next step and a suggested pipeline stage.

It all runs **inside this one Next.js app on Railway** — no extra service, no
Zapier/n8n, no per-operation fees. One scheduled request (`/api/cron`) pulls every
source and runs the AI pass.

```
Gmail (OAuth) ─┐
Google Calendar │→  match to company/contact  →  Activity log  →  Claude insight
Fireflies (API) ┘     (existing engine)            (in CRM)        (summary/next step)
```

---

## What you need

Some of this can only be done by you — accounts and keys. Add platform keys to
**Railway → avelior-analytics → Variables**, then redeploy. Use `.env.example` as
the reference list.

### 1. Google (Gmail + Calendar) — one-click **Connect** *(OAuth, preferred)*
The seamless integration: a tenant clicks **Connecter Google** on the dashboard,
approves once, and Gmail + Calendar start syncing. Emails/meetings are logged
against the right contact; unknown senders go to the **Boîte de réception** queue.

This needs a **one-time Google Cloud setup** (platform-level, done once — not per
user):
1. Create a Google Cloud project; enable the **Gmail API** and **Google Calendar
   API**.
2. **OAuth consent screen.** Scopes: `openid`, `email`, `gmail.readonly`,
   `gmail.send`, `calendar.readonly`, `calendar.events`. (Send/event-write scopes
   are requested now so adding those features later needs no re-consent.)
   - **If the account is on a Google Workspace domain (e.g. `@avelior.eu`): choose
     `Internal`.** No Google verification required, and refresh tokens **don't
     expire** — genuinely seamless.
   - Otherwise the app stays in **Testing** mode: works immediately, but tokens
     expire ~7 days (reconnect from the dashboard) until you complete Google's
     verification (CASA) — a separate, weeks-long process.
3. Create an **OAuth client ID** → type **Web application**. Authorized redirect
   URIs:
   - `http://localhost:3000/api/integrations/google/callback` (dev)
   - `https://<app>/api/integrations/google/callback` (prod)
4. Put the client ID/secret in env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_OAUTH_REDIRECT_URI`. The refresh token is encrypted at rest with the
   existing `ENCRYPTION_KEY`.

Then just open the dashboard and click **Connecter Google**. To switch accounts or
revoke access, click **Déconnecter** (revokes the token at Google too).

> **Legacy fallback:** until a Google account is connected, the app still syncs via
> the old IMAP App-Password (`IMAP_*`) and secret-iCal (`GOOGLE_CALENDAR_ICS_URL`)
> env vars, so nothing goes dark during rollout. Retire those once OAuth is live.

### 2. Fireflies — `FIREFLIES_API_KEY`  *(free tier works)*
Imports call transcripts; uses Fireflies' own AI summary as the raw text.
- Fireflies → **Settings → Developer settings / Integrations → API** → copy the
  API key into `FIREFLIES_API_KEY`.

### 3. The "smart" layer — `GEMINI_API_KEY` *(free)* or `ANTHROPIC_API_KEY`
Reads each interaction and extracts summary / sentiment / next step / stage.
The pipeline picks a provider by which key is set: **`GEMINI_API_KEY` wins if
present**, otherwise it falls back to `ANTHROPIC_API_KEY`.

- **Option A — Google Gemini, FREE (recommended).** At ~10–15 interactions/day
  this stays well inside Gemini's free tier — €0/month. Get a key at
  <https://aistudio.google.com/apikey> (you can reuse the same Google account as
  the Gmail/Calendar integration). Paste into `GEMINI_API_KEY`. Optional
  `GEMINI_MODEL` overrides the default (`gemini-2.5-flash`).
- **Option B — Anthropic Claude (pay-per-use).** <https://console.anthropic.com>
  → **API Keys** → create a key → add a little credit → `ANTHROPIC_API_KEY`.
  Optional `ANTHROPIC_MODEL` (defaults to a cheap, fast Haiku model). Only used
  if `GEMINI_API_KEY` is unset.
- **Without either key everything still runs** — activities are logged, just
  without the AI insight box.

> You do **not** need Claude Pro or Gemini Pro / Advanced for this. Those are
> chat subscriptions; the automation uses the **API key** above. The Gemini
> free-tier API key costs nothing at this volume.

> **Free-tier note:** Gemini's free tier has per-minute and per-day request
> caps. Steady-state syncing is far below them; a large one-off `--backfill`
> can briefly hit the per-minute cap — the AI pass retries once on a 429 and
> otherwise leaves those activities for the next run to enrich, so nothing is
> lost.

---

## Turn on the schedule

Generate the shared secret that protects the cron endpoint and add it as
`CRON_SECRET` (Railway variable):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Then make Railway call the endpoint on a schedule. **Railway → New → Cron**
(or a separate "cron" service) with the command:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron"
```

Suggested cadence: **every 15–30 min** for email, hourly is fine for everything.
The endpoint runs each source independently — if one key is missing or a source
fails, the others still run, and the JSON response shows per-source results.

No Railway cron? Any free scheduler works (e.g. cron-job.org) hitting the same
URL with the `Authorization: Bearer <CRON_SECRET>` header.

---

## Run it manually (local or `railway run`)

```bash
npm run sync:all                 # email + calendar + fireflies + AI pass
npm run sync:all -- --dry        # parse + match, write nothing (safe preview)

npm run sync:email               # just email (--backfill=200 to import history)
npm run sync:calendar            # just calendar  (--dry to preview)
npm run sync:fireflies           # just transcripts (--limit=50, --dry)
```

First run tip: `npm run sync:email -- --backfill=200` and
`npm run sync:fireflies -- --limit=50` to pull recent history once, then let the
cron keep it current.

---

## How matching works (accuracy)

Reuses the engine already proven on the email sync:
1. **Known contact** — counterpart email matches a `Contact.email` → log straight
   onto that contact.
2. **Known company** — email domain matches a company's website/generic email →
   auto-create the contact under it and log.
3. **Unknown** — email senders land in the **review queue** (`/inbox`) for one
   click to approve; calendar/Fireflies events with no match are skipped (counted
   as `unmatched`) rather than guessed.

Free/consumer domains (gmail.com, orange.fr, …) are never treated as a company,
so personal addresses don't create junk companies. Claude is told to extract only
what's present and never invent — and the **suggested stage is shown as a
suggestion**, it does not auto-move cards in your pipeline.

Dedupe is by `Activity.messageId`: RFC Message-ID for email, `cal:<uid>` for
calendar, `ff:<transcript-id>` for Fireflies — re-running is safe.

---

## Cost (rough)

- Gmail IMAP, Calendar iCal, Fireflies free tier: **€0**.
- Claude API: a few hundred interactions/month on the default Haiku model is
  typically **a few euros/month**. Set a spend limit in the Anthropic console.
- Railway: the existing app + a cron trigger, no new database.

---

## Where the data shows up

Open any company → **Activité** timeline. Synced emails/meetings/calls appear
with an **"Analyse IA"** box: summary, sentiment, next step, action items and a
suggested stage. New unknown senders appear in **Boîte de réception** to validate.

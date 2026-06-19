# Auto-enrichment integrations

Connect Christopher's **Gmail**, **Google Calendar** and **Fireflies** so the CRM
fills itself in: every email, meeting and call transcript is matched to the right
company/contact, logged as an activity, and read by Claude to extract a summary,
sentiment, next step and a suggested pipeline stage.

It all runs **inside this one Next.js app on Railway** — no extra service, no
Zapier/n8n, no per-operation fees. One scheduled request (`/api/cron`) pulls every
source and runs the AI pass.

```
Gmail (IMAP)  ─┐
Google Calendar │→  match to company/contact  →  Activity log  →  Claude insight
Fireflies (API) ┘     (existing engine)            (in CRM)        (summary/next step)
```

---

## What you need (4 keys, ~15 min)

Nothing here can be done from code — these are accounts and keys only you can
create. Add each to **Railway → avelior-analytics → Variables**, then redeploy.
Use `.env.example` as the reference list.

### 1. Gmail / Workspace — `IMAP_PASSWORD`  *(already set up earlier)*
Logs sent + received mail against contacts; unknown senders go to the **Boîte de
réception** review queue.
- Google account → **2-Step Verification** must be ON.
- Create an **App Password**: <https://myaccount.google.com/apppasswords> → paste
  into `IMAP_PASSWORD` (no spaces).
- Confirm `IMAP_USER` / `OWNER_EMAIL` are Christopher's address, and IMAP is
  enabled in Gmail → Settings → Forwarding and POP/IMAP.

### 2. Google Calendar — `GOOGLE_CALENDAR_ICS_URL`  *(no OAuth)*
Logs meetings with prospects and advances "dernier contact".
- Google Calendar (web) → hover the calendar → ⋮ → **Settings and sharing**.
- Scroll to **Integrate calendar** → copy **Secret address in iCal format**
  (ends in `/basic.ics`).
- Paste into `GOOGLE_CALENDAR_ICS_URL`. It's read-only; keep it secret.

### 3. Fireflies — `FIREFLIES_API_KEY`  *(free tier works)*
Imports call transcripts; uses Fireflies' own AI summary as the raw text.
- Fireflies → **Settings → Developer settings / Integrations → API** → copy the
  API key into `FIREFLIES_API_KEY`.

### 4. Claude (the "smart" layer) — `ANTHROPIC_API_KEY`
Reads each interaction and extracts summary / sentiment / next step / stage.
- <https://console.anthropic.com> → **API Keys** → create a key → add a little
  credit. Paste into `ANTHROPIC_API_KEY`.
- Optional `ANTHROPIC_MODEL` to override the default (a cheap, fast Haiku model).
- **Without this key everything still runs** — activities are logged, just
  without the AI insight box.

> You do **not** need Claude Pro or Gemini Pro for this. Those are chat
> subscriptions; the automation uses the **Claude API key** above (pay-per-use).
> Keep Claude Pro only if Christopher wants the chat assistant; it's unrelated.

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

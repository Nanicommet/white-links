# 🚀 WHITE LINKS — Deployment Guide

**Goal:** put your app online at a free address like `white-links.vercel.app`, connected to a real database, with optional WhatsApp + AI moderation.

**Time needed:** ~45 minutes. **Cost:** 0 € (all services have free tiers).
**You need:** a computer, a browser, and your club email. No coding required — copy/paste only.

---

## The big picture

```
 GitHub (your code)  →  Vercel (runs the website)
                            ↓
                       Supabase (the database)
                            ↓
                 WhatsApp + AI moderation (optional extras)
```

You will create accounts on 3 websites (all free):

| Service | What it does | Link |
|---|---|---|
| **GitHub** | Stores your code | github.com |
| **Supabase** | Stores your data (members, rounds, messages) | supabase.com |
| **Vercel** | Puts your app online | vercel.com |

---

## STEP 1 — Put the code on GitHub 📦

1. Go to **github.com** → **Sign up** (or log in).
2. Click the **+** icon (top right) → **New repository**.
3. Name it `white-links`. Choose **Private** (recommended: your club's app). Do **NOT** tick "Add a README". Click **Create repository**.
4. GitHub now shows a page with commands. You need to upload this project folder. On your computer, open a terminal in the project folder and run (replace `YOUR-USERNAME`):

```bash
git remote add origin https://github.com/YOUR-USERNAME/white-links.git
git push -u origin main
```

> 💡 It will ask you to log in. If password login fails, GitHub wants a **Personal Access Token**: GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token → tick the `repo` checkbox → copy the token and paste it as the "password".

5. Refresh the GitHub page — you should see all your project files. ✅

---

## STEP 2 — Create the database (Supabase) 🗄️

1. Go to **supabase.com** → **Start your project** → sign up.
2. Click **New project**. Name: `white-links`. Choose a region close to you (e.g. **West EU**). Set a **database password** — click "Generate" and **save it somewhere**, you'll need it in a minute.
3. Wait ~2 minutes while the project is created.
4. Get your connection strings: click the **Connect** button (top bar of the dashboard).
   - You'll see several connection strings. You need **two** of them:
   - **Transaction pooler** (port `6543`) → this will be `DATABASE_URL`
   - **Session pooler** (port `5432`) → this will be `DIRECT_URL`
5. Prepare the two values like this (replace `YOUR-PASSWORD` with the password from step 2, and keep everything else exactly as shown by Supabase):

```
DATABASE_URL = postgresql://postgres.xxxx:YOUR-PASSWORD@aws-0-eu-west-3.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
DIRECT_URL   = postgresql://postgres.xxxx:YOUR-PASSWORD@aws-0-eu-west-3.pooler.supabase.com:5432/postgres
```

> ⚠️ **Important:** on the first string (port 6543) you MUST add `?pgbouncer=true&connection_limit=1` at the end, exactly as shown above.

6. Now create the tables: in Supabase's left sidebar click the **SQL Editor** icon → **New query**. Open the file [`prisma/migrations/20260101000000_init/migration.sql`](./prisma/migrations/20260101000000_init/migration.sql) from this project, **copy its entire content**, paste it into the SQL editor, and click **Run**.
7. Click **Table Editor** (left sidebar) — you should now see tables like `User`, `Round`, `Message`… ✅

---

## STEP 3 — Put the app online (Vercel) 🌍

1. Go to **vercel.com** → **Sign Up** → choose **Continue with GitHub** (easiest).
2. Click **Add New… → Project**. Find your `white-links` repository → click **Import**.
3. Before clicking Deploy, open **Environment Variables** (the section just below) and add these one by one. Copy the name exactly, then paste the value:

| Name | Value | Where it comes from |
|---|---|---|
| `DATABASE_URL` | the 6543 string from Step 2 | Supabase → Connect |
| `DIRECT_URL` | the 5432 string from Step 2 | Supabase → Connect |
| `ADMIN_EMAIL` | e.g. `bureau@whitelineissig.me` | you choose |
| `ADMIN_PASSWORD` | a **strong** password | you choose — save it! |
| `AUTH_SECRET` | 64 random characters | run `openssl rand -hex 32` in a terminal, or any long random text |
| `CRON_SECRET` | 32 random characters | same method, keep it for Step 7 |
| `AI_API_KEY` | *(leave empty for now — Step 5)* | — |
| `WHATSAPP_ACCESS_TOKEN` | *(leave empty for now — Step 6)* | — |
| `WHATSAPP_PHONE_NUMBER_ID` | *(leave empty for now — Step 6)* | — |
| `WHATSAPP_VERIFY_TOKEN` | *(leave empty for now — Step 6)* | — |
| `WHATSAPP_APP_SECRET` | *(leave empty for now — Step 6)* | — |
| `WHATSAPP_TEST_MODE` | `true` | switches to `false` in Step 6 |

4. Click **Deploy** and wait 2–3 minutes. 🎉
5. When it's done, Vercel shows a big **Congratulations** page with your link like `https://white-links-xxxx.vercel.app`. Click it — the WHITE LINKS landing page should appear.

> 🔍 If you see "Application error": open Vercel → your project → **Deployments** → click the latest → **Build Logs** and read the error message. The most common cause is a typo in `DATABASE_URL`.

6. **Log in as admin:** go to `https://your-app.vercel.app/#/white-links/login`, log in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set above. You're the club bureau — you can create rounds, approve members and moderate.

> ✅ **The app is now LIVE and usable with zero extras.** Members register through the website, admin validates, the game runs entirely in the browser. WhatsApp below is a bonus.

---

## STEP 4 — (Optional) Turn on AI moderation 🤖

The app always runs "deterministic filters" (blocks phone numbers, emails, links, insults). An **AI key** adds smart classification (identity hints, Tunisian slang abuse, rule bypassing). Without it, suspicious messages simply wait in the admin **Modération** tab — everything works, just with more manual review.

To enable AI:

1. Create an account at **z.ai** → open **API Keys** → **Create API key** → copy it.
2. Vercel → your project → **Settings** → **Environment Variables** → edit `AI_API_KEY` → paste the key → Save.
3. **Redeploy** (Vercel → Deployments → ⋯ on the latest → **Redeploy**) so the new variable is picked up.

Defaults already set in the code: endpoint `https://api.z.ai/api/paas/v4`, model `glm-4.5-flash` (free/cheap). Different provider? Also set `AI_BASE_URL` and `AI_MODEL`.

---

## STEP 5 — (Optional) Connect WhatsApp 💬

This lets members send/receive anonymous messages through WhatsApp in addition to the website. You need a **Meta developer account** and a phone number that is NOT already on a personal WhatsApp.

### 5.1 Create the Meta app
1. Go to **developers.facebook.com** → **Get Started** / **My Apps** → **Create App** → type: **Business** → name it `White Links` → create.
2. On the app dashboard find the **WhatsApp** product → click **Set up**.
3. Open **WhatsApp → API Setup** (left menu). Here you'll find:
   - **Temporary access token** (valid 24h — for the permanent one, see the note below)
   - **Phone number ID** (a long number)
   - A **test number** you can use to try everything for free (it can message up to 5 verified recipients — perfect to start).

### 5.2 Get the app secret
In the app dashboard: **App Settings → Basic** → **App Secret** → copy it (click "Show", enter your password).

### 5.3 Fill in Vercel
Vercel → Settings → Environment Variables, set:

| Name | Value |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | the access token from 5.1 |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID from 5.1 |
| `WHATSAPP_VERIFY_TOKEN` | **invent** any random string, e.g. `wlc-secret-2026` — keep it, you'll type the same one on Meta's site |
| `WHATSAPP_APP_SECRET` | the App Secret from 5.2 |
| `WHATSAPP_TEST_MODE` | `false` (sends become real) — keep `true` while testing! |

Then **Redeploy**.

### 5.4 Point WhatsApp to your app (webhook)
1. In the Meta app: **WhatsApp → Configuration** (Webhook section) → **Edit**.
2. **Callback URL:** `https://your-app.vercel.app/api/webhooks/whatsapp`
3. **Verify token:** the exact same string you put in `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and save** — it should succeed (the app answers Meta's challenge automatically).
5. Still in the webhook section → **Webhook fields** → **Subscribe** to **`messages`**.

> 📌 **Note on the temporary token:** the token from API Setup expires after 24h. For a permanent token: Meta App → **Business Settings** (business.facebook.com) → **System Users** → create one → **Add Assets** (your app, full control) → **Generate Token** with `whatsapp_business_messaging` + `whatsapp_business_management` permissions. That long-lived token goes into `WHATSAPP_ACCESS_TOKEN`.

### 5.5 Test it
Send `1 hello, hope you're doing great!` from a verified WhatsApp account to the test number. If the sender is a registered & approved member with an active assignment, the message goes through moderation and is delivered anonymously. In Vercel → **Logs** you can watch it live.

---

## STEP 6 — The automatic clock (cron) ⏰

Round phases (closing registrations, opening guesses, revealing…) switch **automatically** based on dates, but something must "tick" the app. Vercel already pings it **once a day** (configured in `vercel.json`). For a smooth game you want a tick every 15 minutes — free with [cron-job.org](https://cron-job.org):

1. Sign up on **cron-job.org** → **Create cronjob**.
2. **URL:** `https://your-app.vercel.app/api/system/tick?key=YOUR-CRON-SECRET` (the secret from Step 3).
3. **Schedule:** every 15 minutes (`*/15 * * * *` — the "default" schedule preset is fine).
4. Save and enable. Done — the game now runs itself. ✅

---

## STEP 7 — Launch your first round (admin checklist)

1. Log in as admin → **Manches** tab → **Nouvelle manche** (name, registration window, matching mode) → create.
2. Open registration (status → `registration_open`). The landing page now shows the live countdown.
3. Members register at `#/white-links/register` (category A "Fille" / B "Garçon" is configurable in Réglages).
4. **Participants** tab → approve each pending registration.
5. At the registration deadline the round closes (tick) → **Appariement** → *Aperçu* to preview → **Finaliser** to confirm matching.
6. The game phase starts — members see their anonymous friend, missions and countdown.
7. **Devinettes** → **Révélation** happen per your dates, with celebration page for winners 🎉.

---

## 🔧 Troubleshooting

| Symptom | Cause & fix |
|---|---|
| "Application error" on the site | Check Vercel → Deployments → Build Logs. 90 % of the time: typo in `DATABASE_URL`/`DIRECT_URL` |
| Tables missing / "relation does not exist" | You skipped Step 2.6 — run the migration SQL in Supabase |
| Admin login fails | The account is created on first server start **only if** `ADMIN_EMAIL` **and** `ADMIN_PASSWORD` are both set in Vercel. Redeploy once after setting them |
| Webhook verification fails on Meta | The URL must be exactly `https://…/api/webhooks/whatsapp`, and the verify token must match **character for character** |
| WhatsApp sends don't arrive | Keep `WHATSAPP_TEST_MODE=false` only when a real number is set; recipient must be registered, approved, and have an active assignment |
| Messages stuck as "En attente" (review) | Normal without `AI_API_KEY` — approve them manually in the Modération tab, or add the key (Step 4) |
| Auto transitions don't happen | Your cron isn't hitting the app. Check cron-job.org's execution log; URL must contain `?key=YOUR-CRON-SECRET` |
| Changed an env var but nothing changed | You must **Redeploy** after every environment variable change |

## 🔒 Security quick-notes

- Never commit `.env` — it's already excluded (`.gitignore`). Real secrets live only in Vercel.
- Rotate `ADMIN_PASSWORD` after the first login (you can add more admin accounts by asking a member, then promoting them in the Participants tab).
- Meta access tokens are powerful — treat them like passwords.
- The database can be paused/backed up from Supabase → Database → Backups.

### Built-in protections (already active — nothing for you to do)

- **Account-takeover protection**: registering with an email that already has an account requires that account's current password — nobody can take over an account by knowing just the email.
- **Brute-force brakes**: login is limited per account (10 tries / 15 min) and per IP; the recovery form and registrations are rate-limited too. A successful login resets the counters.
- **Secure session cookies**: `httpOnly` + `Secure` in production, `SameSite=Lax`, HMAC-signed.
- **Security headers**: Content-Security-Policy, X-Frame-Options (no other site can embed your app in an iframe), nosniff, HSTS, strict referrer policy.
- **Privacy by design**: participants never see phones/e-mails of others; the guessing list is only visible while voting is open; message senders are always anonymized; moderation internals stay hidden from recipients; nothing identifying is ever sent to the AI moderator.
- **No default passwords**: if `ADMIN_EMAIL`/`ADMIN_PASSWORD` are missing, no admin account is created (a warning appears in Vercel logs instead).
- **WhatsApp webhook**: signature-verified with your App Secret + timing-safe token comparison + duplicate delivery protection.

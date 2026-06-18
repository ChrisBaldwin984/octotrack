# OctoTrack daily digest

A private, scheduled Telegram update for **one** Octopus account (Chris's).
Completely separate from the public website — the site stays browser-only and
holds nobody's credentials. This worker holds *your* Octopus API key + account
number as **encrypted Cloudflare secrets** and messages you every morning at
**07:00 UK** (BST/GMT-aware).

It reuses the site's logic modules in `../src` (no duplicated savings maths).

## What it sends

- ⚡🔥 Today & tomorrow unit price vs Flexible Octopus (% cheaper/dearer), per fuel.
- Tracker savings vs Flexible over the rolling **last 7 / 30 / 90 days**.

## Deploy

```bash
cd digest
export CLOUDFLARE_API_TOKEN=<pages/workers deploy token>

# one-time secrets (never committed)
npx wrangler secret put OCTOPUS_API_KEY      # sk_live_…
npx wrangler secret put OCTOPUS_ACCOUNT      # A-XXXXXXXX
npx wrangler secret put TELEGRAM_BOT_TOKEN   # reuse trading bot token
npx wrangler secret put TRIGGER_KEY          # any random string, for manual test

npx wrangler deploy
```

Non-secret config lives in `wrangler.toml` (`TELEGRAM_CHAT_ID`, `GAS_UNITS`,
`CALORIFIC`).

## Test without waiting for the cron

```bash
curl "https://octotrack-digest.<subdomain>.workers.dev/?key=<TRIGGER_KEY>"
```

Runs the digest immediately, sends the Telegram message, and returns the text.
The scheduled cron itself only sends when London local time is 07:00 (it fires
at both 06:00 and 07:00 UTC to cover BST and GMT).

# OctoTrack

Live daily prices for the **Octopus Energy Tracker** tariff — including the latest
**Tracker April 2026 v1** product — plus a savings calculator that prices your real
smart-meter usage against Flexible Octopus.

**Live site:** https://octotrack.cbtech.dev

## Privacy by design

- 100% static site — no server, no database, no cookies, no analytics.
- Your Octopus API key and account number are stored in **your browser's localStorage only**.
- All API calls go directly from your browser to `api.octopus.energy` over HTTPS
  (the Octopus API allows cross-origin requests, so no proxy is needed).
- A strict Content-Security-Policy (`public/_headers`) blocks connections to anywhere
  other than the Octopus API.

## Features

- Today's and tomorrow's Tracker unit rates for electricity and gas, all 14 GB regions
- Price history charts (30/90 days/all) with Flexible Octopus overlaid for comparison
- Every Tracker version back to November 2022, selectable
- **My Savings**: enter your Octopus API key + account number, and it auto-discovers
  your meters, pulls daily consumption, and shows exactly what you saved (or didn't)
  versus Flexible Octopus — headline total, cumulative chart, day-by-day table
- Demo mode with sample usage if you just want to try it
- SMETS2 gas m³ → kWh conversion with adjustable calorific value

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
```

Stack: Vite, vanilla TypeScript, Chart.js. Deployed on Cloudflare Pages.

## Disclaimer

Not affiliated with Octopus Energy. Prices come live from the public
[Octopus API](https://developer.octopus.energy/) and savings figures are estimates —
your bill is the source of truth.

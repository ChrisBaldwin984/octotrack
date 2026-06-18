// OctoTrack daily digest — a private, scheduled Telegram update for one
// account. Completely separate from the public website: the site stays
// browser-only, while this worker holds *your* Octopus credentials as
// encrypted secrets and messages you each morning.
//
// Reuses the site's framework-free logic modules so the savings maths stays
// in one place.

import {
  getAccount,
  getDailyConsumption,
  getStandingCharges,
  getUnitRates,
  type MeterPoint,
} from '../src/api.ts'
import { addDays, londonDate, longDay, todayLondon } from '../src/dates.ts'
import { m3ToKwh } from '../src/gas.ts'
import {
  computeSavings,
  directDebitOnly,
  pence,
  rateOn,
  type DayCost,
  type FuelSavings,
} from '../src/pricing.ts'
import { FLEX_PRODUCT, REGIONS, type Fuel } from '../src/products.ts'
import {
  regionFromTariffCode,
  stitchedTracker,
  stitchedUnitRates,
  versionWindows,
  windowsFromAgreements,
} from '../src/trackerRates.ts'

interface Env {
  OCTOPUS_API_KEY: string
  OCTOPUS_ACCOUNT: string
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_CHAT_ID: string
  GAS_UNITS?: string
  CALORIFIC?: string
  TRIGGER_KEY?: string
}

const FUEL_EMOJI: Record<Fuel, string> = { electricity: '⚡', gas: '🔥' }
const FUEL_NAME: Record<Fuel, string> = { electricity: 'Electricity', gas: 'Gas' }

function londonHour(): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  return parseInt(h, 10) % 24
}

async function sendTelegram(env: Env, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  })
  if (!res.ok) throw new Error(`Telegram send failed (HTTP ${res.status}): ${await res.text()}`)
}

/** "12% cheaper" / "8% dearer" / "pending" — tracker unit rate vs Flexible. */
function vsFlexLabel(tracker: number | undefined, flex: number | null): string {
  if (tracker == null) return 'pending'
  if (flex == null || flex <= 0) return 'n/a'
  const pct = ((flex - tracker) / flex) * 100
  return pct >= 0 ? `${pct.toFixed(0)}% cheaper` : `${Math.abs(pct).toFixed(0)}% dearer`
}

/** Daily consumption for a meter point, aggregated by UK day and in kWh. */
async function consumptionFor(
  env: Env,
  mp: MeterPoint,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const usage = new Map<string, number>()
  for (const serial of mp.serials) {
    const rows = await getDailyConsumption(env.OCTOPUS_API_KEY, mp.fuel, mp.mpxn, serial, from, to)
    for (const row of rows) {
      const date = londonDate(row.interval_start)
      usage.set(date, (usage.get(date) ?? 0) + row.consumption)
    }
  }
  if (mp.fuel === 'gas' && (env.GAS_UNITS ?? 'm3') === 'm3') {
    const cv = Number(env.CALORIFIC ?? '39.5')
    for (const [date, value] of usage) usage.set(date, m3ToKwh(value, cv))
  }
  return usage
}

async function computeFuel(
  fuel: Fuel,
  region: string,
  from: string,
  to: string,
  windows: ReturnType<typeof versionWindows>,
  usage: Map<string, number>,
): Promise<FuelSavings> {
  const [tracker, fl, flSc] = await Promise.all([
    stitchedTracker(fuel, region, from, to, windows),
    getUnitRates(FLEX_PRODUCT, fuel, region),
    getStandingCharges(FLEX_PRODUCT, fuel, region),
  ])
  return computeSavings(usage, tracker.rates, tracker.standing, directDebitOnly(fl), directDebitOnly(flSc))
}

function savedSince(days: DayCost[], fromDate: string): number {
  let saved = 0
  for (const d of days) if (d.date >= fromDate) saved += d.saved
  return saved
}

async function buildDigest(env: Env): Promise<string> {
  const account = await getAccount(env.OCTOPUS_API_KEY, env.OCTOPUS_ACCOUNT)

  // Region straight from the user's own Tracker tariff code.
  let region = 'A'
  for (const mp of account.meterPoints) {
    const ag = mp.agreements.find((a) => a.tariff_code.includes('SILVER')) ?? mp.agreements[0]
    const r = ag && regionFromTariffCode(ag.tariff_code)
    if (r) {
      region = r
      break
    }
  }

  const today = todayLondon()
  const tomorrow = addDays(today, 1)
  const since = addDays(today, -89) // widest window (90 days)
  const fuels = [...new Set(account.meterPoints.map((m) => m.fuel))] as Fuel[]

  // --- Today/tomorrow unit price vs Flexible (no consumption needed) ---
  const priceLines: string[] = []
  // --- Rolling savings, combined across fuels ---
  const totals = { d7: 0, d30: 0, d90: 0 }
  let lastUsageDate = ''

  for (const fuel of fuels) {
    const points = account.meterPoints.filter((m) => m.fuel === fuel)
    const agWindows = windowsFromAgreements(points.flatMap((p) => p.agreements))
    const windows = agWindows.length > 0 ? agWindows : versionWindows()

    // Price comparison for today + tomorrow.
    const [trk, flxRaw] = await Promise.all([
      stitchedUnitRates(fuel, region, today, tomorrow, versionWindows()),
      getUnitRates(FLEX_PRODUCT, fuel, region),
    ])
    const flx = directDebitOnly(flxRaw)
    priceLines.push(
      `${FUEL_EMOJI[fuel]} ${FUEL_NAME[fuel]}: today ${vsFlexLabel(trk.get(today), rateOn(flx, today))}` +
        ` · tomorrow ${vsFlexLabel(trk.get(tomorrow), rateOn(flx, tomorrow))}`,
    )

    // Savings over the last 90 days, sliced into 7/30/90.
    const usages = await Promise.all(points.map((mp) => consumptionFor(env, mp, since, today)))
    const merged = new Map<string, number>()
    for (const u of usages) for (const [d, kwh] of u) merged.set(d, (merged.get(d) ?? 0) + kwh)
    if (merged.size === 0) continue

    const r = await computeFuel(fuel, region, since, today, windows, merged)
    if (r.days.length === 0) continue
    totals.d7 += savedSince(r.days, addDays(today, -6))
    totals.d30 += savedSince(r.days, addDays(today, -29))
    totals.d90 += savedSince(r.days, since)
    const latest = r.days[r.days.length - 1].date
    if (latest > lastUsageDate) lastUsageDate = latest
  }

  const regionName = REGIONS[region] ? `${REGIONS[region]} (${region})` : region
  const lines = [
    `⚡🔥 <b>OctoTrack daily digest</b>`,
    `<i>${regionName} · ${longDay(today)}</i>`,
    ``,
    `<b>Unit price vs Flexible Octopus</b>`,
    ...priceLines,
    ``,
    `<b>Tracker savings vs Flexible</b>`,
    `Last 7 days: <b>${pence(totals.d7)}</b>`,
    `Last 30 days: <b>${pence(totals.d30)}</b>`,
    `Last 90 days: <b>${pence(totals.d90)}</b>`,
  ]
  if (lastUsageDate) lines.push(`<i>Savings based on usage up to ${longDay(lastUsageDate)}.</i>`)
  return lines.join('\n')
}

async function run(env: Env): Promise<string> {
  try {
    const msg = await buildDigest(env)
    await sendTelegram(env, msg)
    return msg
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // Surface failures to Telegram too, so a silent break is obvious.
    try {
      await sendTelegram(env, `⚠️ <b>OctoTrack digest failed</b>\n${detail}`)
    } catch {
      /* ignore secondary failure */
    }
    throw err
  }
}

export default {
  // Cron entry — only sends at 07:00 UK local time.
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    if (londonHour() !== 7) return
    await run(env)
  },

  // Manual test trigger: GET /?key=<TRIGGER_KEY> runs the digest now and
  // returns the message text. Guarded so it can't be triggered publicly.
  async fetch(req: Request, env: Env): Promise<Response> {
    const key = new URL(req.url).searchParams.get('key')
    if (!env.TRIGGER_KEY || key !== env.TRIGGER_KEY) {
      return new Response('Not found', { status: 404 })
    }
    const msg = await run(env)
    return new Response(msg, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
  },
}

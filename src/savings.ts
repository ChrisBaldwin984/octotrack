import '@fontsource-variable/archivo'
import '@fontsource-variable/spline-sans-mono'
import './style.css'

import type { Chart } from 'chart.js'
import {
  getAccount,
  getDailyConsumption,
  getStandingCharges,
  getUnitRates,
  regionFromPostcode,
  type AccountInfo,
  type MeterPoint,
} from './api.ts'
import { costBars, savingsChart, COLORS, type CostRow } from './charts.ts'
import { addDays, londonDate, longDay, shortDay, todayLondon } from './dates.ts'
import { demoUsage } from './demo.ts'
import { m3ToKwh } from './gas.ts'
import {
  avgRates,
  byMonth,
  computeSavings,
  directDebitOnly,
  pence,
  type FuelSavings,
} from './pricing.ts'
import { DEFAULT_VERSION, FLEX_PRODUCT, REGIONS, type Fuel } from './products.ts'
import { registerServiceWorker } from './pwa.ts'
import { clearCredentials, settings } from './storage.ts'

registerServiceWorker()
import {
  regionFromTariffCode,
  stitchedTracker,
  versionWindows,
  windowsFromAgreements,
  type TrackerWindow,
} from './trackerRates.ts'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

const form = $<HTMLFormElement>('#connect-form')
const apiKeyInput = $<HTMLInputElement>('#api-key')
const accountInput = $<HTMLInputElement>('#account')
const postcodeInput = $<HTMLInputElement>('#postcode')
const postcodeHint = $('#postcode-hint')
const regionSel = $<HTMLSelectElement>('#region')
const gasUnitsSel = $<HTMLSelectElement>('#gas-units')
const calorificInput = $<HTMLInputElement>('#calorific')
const statusEl = $('#status')
const resultsEl = $('#results')
const headlineEl = $('#headline')
const tariffLineEl = $('#tariff-line')
const fuelTabsEl = $('#fuel-tabs')
const barsTitleEl = $('#bars-title')
const barsInnerEl = $('#bars-inner')
const barsCanvas = $<HTMLCanvasElement>('#bars-chart')
const statsEl = $('#stats')
const detailSection = $<HTMLElement>('#detail-section')
const tableWrap = $('#table-wrap')
const cumCanvas = $<HTMLCanvasElement>('#savings-chart')
const demoBadge = $('#demo-badge')
const customRangeEl = $('#custom-range')
const dateFromInput = $<HTMLInputElement>('#date-from')
const dateToInput = $<HTMLInputElement>('#date-to')
const presetBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-preset]')]
const modeBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')]

let lastSource: 'real' | 'demo' | null = null
let accountInfo: AccountInfo | null = null
let data = new Map<Fuel, FuelSavings>()
let rangeShown: { from: string; to: string } | null = null
let activeFuel: Fuel = 'electricity'
let mode: 'monthly' | 'daily' = 'monthly'
let preset = 'tariff'
let barsChart: Chart | null = null
let cumChart: Chart | null = null
let detailDirty = true

for (const [letter, name] of Object.entries(REGIONS)) {
  regionSel.add(new Option(`${name} (${letter})`, letter))
}
regionSel.value = settings.region
apiKeyInput.value = settings.apiKey
accountInput.value = settings.account
postcodeInput.value = settings.postcode
gasUnitsSel.value = settings.gasUnits
calorificInput.value = String(settings.calorificValue)
dateFromInput.value = DEFAULT_VERSION.from
dateToInput.value = todayLondon()
dateToInput.max = todayLondon()

regionSel.addEventListener('change', () => (settings.region = regionSel.value))

function setPostcodeHint(msg: string, isError = false): void {
  postcodeHint.textContent = msg
  postcodeHint.classList.toggle('error', isError)
}

// Show the matched region name if a postcode was already saved.
if (settings.postcode && settings.region in REGIONS) {
  setPostcodeHint(`Region: ${REGIONS[settings.region]} (${settings.region})`)
}

async function lookupPostcode(): Promise<void> {
  const pc = postcodeInput.value.trim()
  if (!pc) {
    setPostcodeHint('Enter your postcode to set your region automatically')
    return
  }
  settings.postcode = pc
  setPostcodeHint('Finding your region…')
  try {
    const region = await regionFromPostcode(pc)
    if (!region) {
      setPostcodeHint("Couldn't match that postcode — pick your region below.", true)
      return
    }
    regionSel.value = region
    settings.region = region
    setPostcodeHint(`Region: ${REGIONS[region]} (${region})`)
  } catch {
    setPostcodeHint("Couldn't look that up just now — pick your region below.", true)
  }
}

postcodeInput.addEventListener('change', () => void lookupPostcode())

$('#clear-btn').addEventListener('click', () => {
  clearCredentials()
  apiKeyInput.value = ''
  accountInput.value = ''
  postcodeInput.value = ''
  setPostcodeHint('Enter your postcode to set your region automatically')
  accountInfo = null
  lastSource = null
  resultsEl.hidden = true
  setStatus('Your details have been removed from this browser.')
})

form.addEventListener('submit', (e) => {
  e.preventDefault()
  void runReal()
})

$('#demo-btn').addEventListener('click', () => void runDemo())

for (const btn of presetBtns) {
  btn.addEventListener('click', () => {
    preset = btn.dataset.preset!
    for (const b of presetBtns) b.classList.toggle('active', b === btn)
    customRangeEl.hidden = preset !== 'custom'
    if (preset !== 'custom') void rerun()
  })
}
$('#apply-range').addEventListener('click', () => void rerun())

for (const btn of modeBtns) {
  btn.addEventListener('click', () => {
    mode = btn.dataset.mode as 'monthly' | 'daily'
    for (const b of modeBtns) b.classList.toggle('active', b === btn)
    renderBars()
  })
}

detailSection.addEventListener('toggle', () => {
  if (detailSection.hasAttribute('open') && detailDirty) renderDetail()
})

function setStatus(msg: string, isError = false): void {
  statusEl.textContent = msg
  statusEl.classList.toggle('error', isError)
}

function setBusy(busy: boolean): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('button')) b.disabled = busy
}

function resolveRange(): { from: string; to: string } {
  const today = todayLondon()
  switch (preset) {
    case '30':
      return { from: addDays(today, -29), to: today }
    case '90':
      return { from: addDays(today, -89), to: today }
    case '365':
      return { from: addDays(today, -364), to: today }
    case 'custom': {
      let from = dateFromInput.value || DEFAULT_VERSION.from
      let to = dateToInput.value || today
      if (to > today) to = today
      if (from > to) [from, to] = [to, from]
      return { from, to }
    }
    default:
      return { from: DEFAULT_VERSION.from, to: today }
  }
}

async function computeFuel(
  fuel: Fuel,
  region: string,
  from: string,
  to: string,
  windows: TrackerWindow[],
  usage: Map<string, number>,
): Promise<FuelSavings> {
  const [tracker, fl, flSc] = await Promise.all([
    stitchedTracker(fuel, region, from, to, windows),
    getUnitRates(FLEX_PRODUCT, fuel, region),
    getStandingCharges(FLEX_PRODUCT, fuel, region),
  ])
  return computeSavings(usage, tracker.rates, tracker.standing, directDebitOnly(fl), directDebitOnly(flSc))
}

async function consumptionFor(
  apiKey: string,
  mp: MeterPoint,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const usage = new Map<string, number>()
  for (const serial of mp.serials) {
    const rows = await getDailyConsumption(apiKey, mp.fuel, mp.mpxn, serial, from, to)
    for (const row of rows) {
      const date = londonDate(row.interval_start)
      usage.set(date, (usage.get(date) ?? 0) + row.consumption)
    }
  }
  if (mp.fuel === 'gas' && settings.gasUnits === 'm3') {
    for (const [date, value] of usage) {
      usage.set(date, m3ToKwh(value, settings.calorificValue))
    }
  }
  return usage
}

async function runReal(): Promise<void> {
  const apiKey = apiKeyInput.value.trim()
  const account = accountInput.value.trim().toUpperCase()
  if (!apiKey || !account) {
    setStatus('Enter both your API key and account number.', true)
    return
  }
  settings.apiKey = apiKey
  settings.account = account
  settings.gasUnits = gasUnitsSel.value as 'm3' | 'kwh'
  settings.calorificValue = Number(calorificInput.value)

  // Never let a previous demo view (and its badge) linger if the connect
  // fails or returns no usage — clear it before we start.
  lastSource = null
  demoBadge.hidden = true

  setBusy(true)
  try {
    setStatus('Looking up your meters…')
    accountInfo = await getAccount(apiKey, account)

    // pick the region straight from the user's own tariff code
    for (const mp of accountInfo.meterPoints) {
      const ag = mp.agreements.find((a) => a.tariff_code.includes('SILVER')) ?? mp.agreements[0]
      const region = ag && regionFromTariffCode(ag.tariff_code)
      if (region) {
        regionSel.value = region
        settings.region = region
        break
      }
    }

    const { from, to } = resolveRange()
    setStatus('Fetching your usage and daily prices…')
    const region = regionSel.value
    const fuels = [...new Set(accountInfo.meterPoints.map((m) => m.fuel))]

    const results = new Map<Fuel, FuelSavings>()
    for (const fuel of fuels) {
      const points = accountInfo.meterPoints.filter((m) => m.fuel === fuel)
      const agreementWindows = windowsFromAgreements(points.flatMap((p) => p.agreements))
      const windows = agreementWindows.length > 0 ? agreementWindows : versionWindows()
      const usages = await Promise.all(points.map((mp) => consumptionFor(apiKey, mp, from, to)))
      const merged = new Map<string, number>()
      for (const u of usages) {
        for (const [d, kwh] of u) merged.set(d, (merged.get(d) ?? 0) + kwh)
      }
      if (merged.size === 0) continue
      const r = await computeFuel(fuel, region, from, to, windows, merged)
      if (r.days.length > 0) results.set(fuel, r)
    }

    if (results.size === 0) {
      resultsEl.hidden = true
      setStatus(
        'No usage found in that period while you were on Tracker — try a different date range, or note that Octopus can take a day or two to publish readings.',
        true,
      )
      return
    }
    lastSource = 'real'
    data = results
    rangeShown = { from, to }
    render(false)
    setStatus('')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Something went wrong.', true)
  } finally {
    setBusy(false)
  }
}

async function runDemo(): Promise<void> {
  setBusy(true)
  try {
    setStatus('Loading demo with live prices and sample usage…')
    const { from, to } = resolveRange()
    const region = regionSel.value
    const results = new Map<Fuel, FuelSavings>()
    for (const fuel of ['electricity', 'gas'] as Fuel[]) {
      const r = await computeFuel(fuel, region, from, to, versionWindows(), demoUsage(from, fuel))
      if (r.days.length > 0) results.set(fuel, r)
    }
    if (results.size === 0) {
      setStatus('No Tracker prices exist in that period — try a different range.', true)
      return
    }
    lastSource = 'demo'
    data = results
    rangeShown = { from, to }
    render(true)
    setStatus('')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Something went wrong.', true)
  } finally {
    setBusy(false)
  }
}

async function rerun(): Promise<void> {
  if (lastSource === 'real') await runReal()
  else if (lastSource === 'demo') await runDemo()
}

function tariffLine(isDemo: boolean): string {
  const period = rangeShown ? `${longDay(rangeShown.from)} → ${longDay(rangeShown.to)}` : ''
  if (isDemo) return `Demo household · ${period} · ${REGIONS[regionSel.value]}`
  const products = new Set<string>()
  for (const mp of accountInfo?.meterPoints ?? []) {
    for (const a of mp.agreements) {
      if (a.tariff_code.includes('SILVER')) {
        products.add(a.tariff_code.replace(/^[EG]-1R-/, '').replace(/-[A-P]$/, ''))
      }
    }
  }
  const tariffs = products.size > 0 ? `Tracker (${[...products].join(', ')})` : 'Tracker'
  return `${tariffs} · ${period} · ${REGIONS[regionSel.value]}`
}

function render(isDemo: boolean): void {
  resultsEl.hidden = false
  demoBadge.hidden = !isDemo
  tariffLineEl.textContent = tariffLine(isDemo)

  const fuels = [...data.keys()]
  if (!fuels.includes(activeFuel)) activeFuel = fuels[0]

  fuelTabsEl.innerHTML = fuels
    .map(
      (f) =>
        `<button role="tab" data-fuel="${f}" class="${f}${f === activeFuel ? ' active' : ''}" aria-selected="${f === activeFuel}">
          ${f === 'electricity' ? '⚡ Electricity' : '🔥 Gas'}
        </button>`,
    )
    .join('')
  for (const btn of fuelTabsEl.querySelectorAll<HTMLButtonElement>('[data-fuel]')) {
    btn.addEventListener('click', () => {
      activeFuel = btn.dataset.fuel as Fuel
      render(isDemo)
    })
  }

  const all = [...data.values()]
  const totalSaved = all.reduce((a, r) => a + r.totalSaved, 0)
  const totalTracker = all.reduce((a, r) => a + r.totalTrackerCost, 0)
  const totalFlex = all.reduce((a, r) => a + r.totalFlexCost, 0)
  const won = totalSaved >= 0
  headlineEl.className = won ? 'headline won' : 'headline lost'
  headlineEl.innerHTML = `
    <p class="headline-label">${won ? 'Tracker has saved you' : 'Tracker has cost you an extra'}</p>
    <p class="headline-figure">${pence(Math.abs(totalSaved))}</p>
    <p class="headline-sub">you paid ${pence(totalTracker)} vs ${pence(totalFlex)} on Flexible Octopus${data.size > 1 ? ' (both fuels)' : ''}</p>`

  renderStats()
  renderBars()
  detailDirty = true
  if (detailSection.hasAttribute('open')) renderDetail()
}

function renderStats(): void {
  const r = data.get(activeFuel)
  if (!r) return
  const pct = r.totalFlexCost > 0 ? (r.totalSaved / r.totalFlexCost) * 100 : 0
  const rates = avgRates(r.days)
  const ratePct = rates.flex > 0 ? ((rates.flex - rates.tracker) / rates.flex) * 100 : 0
  const fmtPct = (v: number) => `${v >= 0 ? '−' : '+'}${Math.abs(v).toFixed(0)}% vs Flexible`
  const won = r.totalSaved >= 0
  statsEl.innerHTML = `
    <div class="stat">
      <span class="stat-label">Total saving</span>
      <span class="stat-value ${won ? 'won' : 'lost'}">${pence(r.totalSaved)}</span>
      <span class="stat-sub">${fmtPct(pct)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Average unit rate</span>
      <span class="stat-value">${rates.tracker.toFixed(2)}p</span>
      <span class="stat-sub">${fmtPct(ratePct)}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Total cost on Tracker</span>
      <span class="stat-value">${pence(r.totalTrackerCost)}</span>
      <span class="stat-sub">${r.totalKwh.toFixed(0)} kWh over ${r.days.length} days</span>
    </div>
    <div class="stat">
      <span class="stat-label">Flexible would've cost</span>
      <span class="stat-value">${pence(r.totalFlexCost)}</span>
      <span class="stat-sub">incl. standing charges</span>
    </div>`
}

const DAILY_BAR_LIMIT = 92

function renderBars(): void {
  const r = data.get(activeFuel)
  if (!r) return

  let rows: CostRow[]
  if (mode === 'monthly') {
    barsTitleEl.textContent = 'Monthly breakdown'
    rows = byMonth(r.days).map((m) => ({
      label: m.label,
      tracker: m.trackerCost / 100,
      flex: m.flexCost / 100,
      saved: m.saved / 100,
    }))
  } else {
    const recent = r.days.slice(-DAILY_BAR_LIMIT).reverse()
    barsTitleEl.textContent =
      r.days.length > DAILY_BAR_LIMIT ? `Daily breakdown (last ${DAILY_BAR_LIMIT} days)` : 'Daily breakdown'
    rows = recent.map((d) => ({
      label: shortDay(d.date),
      tracker: d.trackerCost / 100,
      flex: d.flexCost / 100,
      saved: d.saved / 100,
    }))
  }

  barsInnerEl.style.height = `${Math.max(300, rows.length * 34 + 60)}px`
  barsChart?.destroy()
  barsChart = costBars(barsCanvas, rows, activeFuel === 'electricity' ? COLORS.elec : COLORS.gas)
}

function renderDetail(): void {
  detailDirty = false
  const all = [...data.values()]
  const dayTotals = new Map<string, number>()
  for (const r of all) {
    for (const d of r.days) dayTotals.set(d.date, (dayTotals.get(d.date) ?? 0) + d.saved)
  }
  const dates = [...dayTotals.keys()].sort()
  let acc = 0
  const cumulative = dates.map((d) => {
    acc += dayTotals.get(d)! / 100
    return Math.round(acc * 100) / 100
  })
  cumChart?.destroy()
  cumChart = savingsChart(cumCanvas, dates.map(longDay), cumulative)

  const rows = dates
    .slice()
    .reverse()
    .map((date) => {
      const saved = dayTotals.get(date)!
      const kwh = all.reduce((a, r) => a + (r.days.find((d) => d.date === date)?.kwh ?? 0), 0)
      const tracker = all.reduce((a, r) => a + (r.days.find((d) => d.date === date)?.trackerCost ?? 0), 0)
      const flex = all.reduce((a, r) => a + (r.days.find((d) => d.date === date)?.flexCost ?? 0), 0)
      return `<tr>
        <td>${longDay(date)}</td>
        <td>${kwh.toFixed(1)}</td>
        <td>${pence(tracker)}</td>
        <td>${pence(flex)}</td>
        <td class="${saved >= 0 ? 'won' : 'lost'}">${pence(saved)}</td>
      </tr>`
    })
  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>Day</th><th>kWh</th><th>Tracker</th><th>Flexible</th><th>Saved</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`
}

$('#updated').textContent = `Prices include VAT. Last checked ${todayLondon()}.`

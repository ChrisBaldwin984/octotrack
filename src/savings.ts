import '@fontsource-variable/archivo'
import '@fontsource-variable/spline-sans-mono'
import './style.css'

import type { Chart } from 'chart.js'
import {
  getAccount,
  getDailyConsumption,
  getStandingCharges,
  getUnitRates,
  type MeterPoint,
} from './api.ts'
import { savingsChart } from './charts.ts'
import { addDays, londonDate, longDay, todayLondon } from './dates.ts'
import { demoUsage } from './demo.ts'
import { m3ToKwh } from './gas.ts'
import {
  computeSavings,
  dailyRateMap,
  directDebitOnly,
  pence,
  type FuelSavings,
} from './pricing.ts'
import { DEFAULT_VERSION, FLEX_PRODUCT, REGIONS, type Fuel } from './products.ts'
import { clearCredentials, settings } from './storage.ts'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

const form = $<HTMLFormElement>('#connect-form')
const apiKeyInput = $<HTMLInputElement>('#api-key')
const accountInput = $<HTMLInputElement>('#account')
const regionSel = $<HTMLSelectElement>('#region')
const gasUnitsSel = $<HTMLSelectElement>('#gas-units')
const calorificInput = $<HTMLInputElement>('#calorific')
const statusEl = $('#status')
const resultsEl = $('#results')
const headlineEl = $('#headline')
const breakdownEl = $('#breakdown')
const tableWrap = $('#table-wrap')
const chartCanvas = $<HTMLCanvasElement>('#savings-chart')
const demoBadge = $('#demo-badge')

let chart: Chart | null = null

for (const [letter, name] of Object.entries(REGIONS)) {
  regionSel.add(new Option(`${name} (${letter})`, letter))
}
regionSel.value = settings.region
apiKeyInput.value = settings.apiKey
accountInput.value = settings.account
gasUnitsSel.value = settings.gasUnits
calorificInput.value = String(settings.calorificValue)

regionSel.addEventListener('change', () => (settings.region = regionSel.value))

$('#clear-btn').addEventListener('click', () => {
  clearCredentials()
  apiKeyInput.value = ''
  accountInput.value = ''
  resultsEl.hidden = true
  setStatus('Your details have been removed from this browser.')
})

form.addEventListener('submit', (e) => {
  e.preventDefault()
  void runReal()
})

$('#demo-btn').addEventListener('click', () => void runDemo())

function setStatus(msg: string, isError = false): void {
  statusEl.textContent = msg
  statusEl.classList.toggle('error', isError)
}

function setBusy(busy: boolean): void {
  for (const b of form.querySelectorAll('button')) b.disabled = busy
  ;($('#demo-btn') as HTMLButtonElement).disabled = busy
}

interface RatePack {
  tracker: Map<string, number>
  trackerSc: ReturnType<typeof directDebitOnly>
  flex: ReturnType<typeof directDebitOnly>
  flexSc: ReturnType<typeof directDebitOnly>
}

async function loadRates(fuel: Fuel, region: string, from: string): Promise<RatePack> {
  const product = DEFAULT_VERSION.code
  const [tr, trSc, fl, flSc] = await Promise.all([
    getUnitRates(product, fuel, region, from),
    getStandingCharges(product, fuel, region),
    getUnitRates(FLEX_PRODUCT, fuel, region),
    getStandingCharges(FLEX_PRODUCT, fuel, region),
  ])
  return {
    tracker: dailyRateMap(tr),
    trackerSc: directDebitOnly(trSc),
    flex: directDebitOnly(fl),
    flexSc: directDebitOnly(flSc),
  }
}

function savingsFor(usage: Map<string, number>, rates: RatePack): FuelSavings {
  return computeSavings(usage, rates.tracker, rates.trackerSc, rates.flex, rates.flexSc)
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

  setBusy(true)
  demoBadge.hidden = true
  try {
    setStatus('Looking up your meters…')
    const info = await getAccount(apiKey, account)

    const tariffStart = DEFAULT_VERSION.from
    const joined = info.trackerSince ? londonDate(info.trackerSince) : tariffStart
    const from = joined > tariffStart ? joined : tariffStart
    const to = todayLondon()

    setStatus('Fetching your usage and daily prices…')
    const region = regionSel.value
    const fuels: Fuel[] = [...new Set(info.meterPoints.map((m) => m.fuel))]

    const results = new Map<Fuel, FuelSavings>()
    for (const fuel of fuels) {
      const points = info.meterPoints.filter((m) => m.fuel === fuel)
      const [rates, ...usages] = await Promise.all([
        loadRates(fuel, region, from),
        ...points.map((mp) => consumptionFor(apiKey, mp, from, to)),
      ])
      const merged = new Map<string, number>()
      for (const u of usages) {
        for (const [d, kwh] of u) merged.set(d, (merged.get(d) ?? 0) + kwh)
      }
      if (merged.size > 0) results.set(fuel, savingsFor(merged, rates))
    }

    if (results.size === 0) {
      setStatus(
        'No smart-meter readings found since the tariff started — Octopus can take a day or two to publish them.',
        true,
      )
      return
    }
    render(results, from, false)
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
    const region = regionSel.value
    const from = DEFAULT_VERSION.from
    const results = new Map<Fuel, FuelSavings>()
    for (const fuel of ['electricity', 'gas'] as Fuel[]) {
      const rates = await loadRates(fuel, region, from)
      results.set(fuel, savingsFor(demoUsage(from, fuel), rates))
    }
    render(results, from, true)
    setStatus('')
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Something went wrong.', true)
  } finally {
    setBusy(false)
  }
}

function render(results: Map<Fuel, FuelSavings>, from: string, isDemo: boolean): void {
  const all = [...results.values()]
  const totalSaved = all.reduce((a, r) => a + r.totalSaved, 0)
  const totalTracker = all.reduce((a, r) => a + r.totalTrackerCost, 0)
  const totalFlex = all.reduce((a, r) => a + r.totalFlexCost, 0)

  demoBadge.hidden = !isDemo
  resultsEl.hidden = false

  const won = totalSaved >= 0
  headlineEl.className = won ? 'won' : 'lost'
  headlineEl.innerHTML = `
    <p class="headline-label">${won ? 'Tracker has saved you' : 'Tracker has cost you an extra'}</p>
    <p class="headline-figure">${pence(Math.abs(totalSaved))}</p>
    <p class="headline-sub">since ${longDay(from)} · you paid ${pence(totalTracker)} vs ${pence(totalFlex)} on Flexible Octopus</p>`

  breakdownEl.innerHTML = [...results.entries()]
    .map(([fuel, r]) => {
      const cls = fuel === 'electricity' ? 'elec' : 'gas'
      return `
      <article class="card ${cls}">
        <header><span class="fuel-dot"></span>${fuel === 'electricity' ? 'Electricity' : 'Gas'}</header>
        <p class="price"><strong>${pence(r.totalSaved)}</strong><span class="unit">${r.totalSaved >= 0 ? 'saved' : 'lost'}</span></p>
        <footer>${r.totalKwh.toFixed(0)} kWh over ${r.days.length} days</footer>
      </article>`
    })
    .join('')

  // cumulative chart across union of dates
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
  chart?.destroy()
  chart = savingsChart(chartCanvas, dates.map(longDay), cumulative)

  // daily table, most recent first
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

  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

$('#updated').textContent = `Prices include VAT. Last checked ${addDays(todayLondon(), 0)}.`

import '@fontsource-variable/archivo'
import '@fontsource-variable/spline-sans-mono'
import './style.css'

import type { Chart } from 'chart.js'
import { getStandingCharges, getUnitRates, type Rate } from './api.ts'
import { COLORS, priceChart, type Series } from './charts.ts'
import { addDays, londonDate, shortDay, todayLondon } from './dates.ts'
import { dailyRateMap, directDebitOnly, rateOn } from './pricing.ts'
import { CAPS, DEFAULT_VERSION, FLEX_PRODUCT, REGIONS, TRACKER_VERSIONS, versionByCode, type Fuel } from './products.ts'
import { registerServiceWorker } from './pwa.ts'
import { settings } from './storage.ts'
import { stitchedUnitRates, versionWindows } from './trackerRates.ts'

registerServiceWorker()

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

const regionSel = $<HTMLSelectElement>('#region')
const versionSel = $<HTMLSelectElement>('#version')
const statusEl = $('#status')
const cardsEl = $('#cards')
const standingEl = $('#standing')
const elecCanvas = $<HTMLCanvasElement>('#elec-chart')
const gasCanvas = $<HTMLCanvasElement>('#gas-chart')
const rangeBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-range]')]

let charts: Chart[] = []
let loaded: {
  elec: Map<string, number>
  gas: Map<string, number>
  flexElec: Rate[]
  flexGas: Rate[]
} | null = null
let range = 7

for (const [letter, name] of Object.entries(REGIONS)) {
  regionSel.add(new Option(`${name} (${letter})`, letter))
}
for (const v of TRACKER_VERSIONS) {
  versionSel.add(new Option(`Tracker ${v.name}${v.to === null ? ' — current' : ''}`, v.code))
}
regionSel.value = settings.region
versionSel.value = versionByCode(settings.version || DEFAULT_VERSION.code).code

regionSel.addEventListener('change', () => {
  settings.region = regionSel.value
  void load()
})
versionSel.addEventListener('change', () => {
  settings.version = versionSel.value
  void load()
})
for (const btn of rangeBtns) {
  btn.addEventListener('click', () => {
    range = Number(btn.dataset.range)
    for (const b of rangeBtns) b.classList.toggle('active', b === btn)
    applyRange()
  })
}

function fmt(p: number): string {
  return p.toFixed(2)
}

function priceCard(
  fuel: Fuel,
  title: string,
  date: string,
  rate: number | undefined,
  prevRate: number | undefined,
  flexRate: number | null,
): string {
  const cls = fuel === 'electricity' ? 'elec' : 'gas'
  if (rate === undefined) {
    return `
      <article class="card ${cls} pending">
        <header><span class="fuel-dot"></span>${title}</header>
        <p class="price-pending">Published around midnight</p>
        <footer>${shortDay(date)}</footer>
      </article>`
  }
  let delta = ''
  if (prevRate !== undefined && prevRate > 0) {
    const pct = ((rate - prevRate) / prevRate) * 100
    const dir = pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat'
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'
    delta = `<span class="delta ${dir}">${arrow} ${Math.abs(pct).toFixed(1)}%</span>`
  }
  let vsFlex = ''
  if (flexRate !== null && flexRate > 0) {
    const pct = ((flexRate - rate) / flexRate) * 100
    vsFlex =
      pct >= 0
        ? `${pct.toFixed(0)}% below Flexible`
        : `${Math.abs(pct).toFixed(0)}% above Flexible`
  }
  return `
    <article class="card ${cls}">
      <header><span class="fuel-dot"></span>${title}</header>
      <p class="price"><strong>${fmt(rate)}</strong><span class="unit">p/kWh</span>${delta}</p>
      <footer>${shortDay(date)}${vsFlex ? ` · ${vsFlex}` : ''}</footer>
    </article>`
}

async function load(): Promise<void> {
  const region = regionSel.value
  const version = versionByCode(versionSel.value)
  statusEl.textContent = 'Fetching live prices from Octopus…'
  statusEl.classList.remove('error')
  cardsEl.classList.add('loading')

  try {
    // For the current product, chart a full year by stitching daily rates across
    // whichever Tracker version was live on each day. Historic products chart
    // their own lifetime only.
    const isCurrent = version.to === null
    const yearAgo = addDays(todayLondon(), -364)
    const chartEnd = addDays(todayLondon(), 1)

    const fetchTracker = (fuel: Fuel): Promise<Map<string, number>> =>
      isCurrent
        ? stitchedUnitRates(fuel, region, yearAgo, chartEnd, versionWindows())
        : getUnitRates(version.code, fuel, region, version.from).then(dailyRateMap)

    const [elecMap, gasMap, flexElec, flexGas, scElec, scGas] = await Promise.all([
      fetchTracker('electricity'),
      fetchTracker('gas'),
      getUnitRates(FLEX_PRODUCT, 'electricity', region),
      getUnitRates(FLEX_PRODUCT, 'gas', region),
      getStandingCharges(version.code, 'electricity', region),
      getStandingCharges(version.code, 'gas', region),
    ])

    loaded = {
      elec: elecMap,
      gas: gasMap,
      flexElec: directDebitOnly(flexElec),
      flexGas: directDebitOnly(flexGas),
    }

    const today = todayLondon()
    const tomorrow = addDays(today, 1)
    const yesterday = addDays(today, -1)

    cardsEl.innerHTML =
      priceCard('electricity', 'Electricity · today', today, loaded.elec.get(today), loaded.elec.get(yesterday), rateOn(loaded.flexElec, today)) +
      priceCard('electricity', 'Electricity · tomorrow', tomorrow, loaded.elec.get(tomorrow), loaded.elec.get(today), rateOn(loaded.flexElec, today)) +
      priceCard('gas', 'Gas · today', today, loaded.gas.get(today), loaded.gas.get(yesterday), rateOn(loaded.flexGas, today)) +
      priceCard('gas', 'Gas · tomorrow', tomorrow, loaded.gas.get(tomorrow), loaded.gas.get(today), rateOn(loaded.flexGas, today))

    const scE = rateOn(directDebitOnly(scElec), today)
    const scG = rateOn(directDebitOnly(scGas), today)
    standingEl.textContent =
      `Standing charges in ${REGIONS[region]}: ` +
      `electricity ${scE === null ? '—' : fmt(scE)}p/day · gas ${scG === null ? '—' : fmt(scG)}p/day. ` +
      `Tracker prices are capped at ${CAPS.electricity}p/kWh (electricity) and ${CAPS.gas}p/kWh (gas), inc VAT.`

    statusEl.textContent = ''
    renderChart()
  } catch (err) {
    statusEl.textContent = err instanceof Error ? err.message : 'Something went wrong fetching prices.'
    statusEl.classList.add('error')
  } finally {
    cardsEl.classList.remove('loading')
  }
}

function renderChart(): void {
  if (!loaded) return
  const dates = [...loaded.elec.keys()].sort()
  const labels = dates.map(shortDay)

  const flexElecData = dates.map((d) => rateOn(loaded!.flexElec, d))
  const flexGasData = dates.map((d) => rateOn(loaded!.flexGas, d))

  const elecSeries: Series[] = [
    {
      label: 'Tracker electricity',
      data: dates.map((d) => loaded!.elec.get(d) ?? null),
      color: COLORS.elec,
      gradeAgainst: flexElecData,
    },
    { label: 'Flexible electricity (price cap)', data: flexElecData, color: COLORS.flex, dashed: true },
  ]
  const gasSeries: Series[] = [
    {
      label: 'Tracker gas',
      data: dates.map((d) => loaded!.gas.get(d) ?? null),
      color: COLORS.gas,
      gradeAgainst: flexGasData,
    },
    { label: 'Flexible gas (price cap)', data: flexGasData, color: '#7d6b8c', dashed: true },
  ]

  for (const c of charts) c.destroy()
  charts = [priceChart(elecCanvas, labels, elecSeries, 'p'), priceChart(gasCanvas, labels, gasSeries, 'p')]
  applyRange()
}

function applyRange(): void {
  for (const chart of charts) {
    const n = chart.data.labels?.length ?? 0
    const x = chart.options.scales!.x as { min?: number; max?: number }
    x.min = range > 0 ? Math.max(0, n - range) : 0
    x.max = n - 1
    chart.update()
  }
}

$('#updated').textContent = `Prices include VAT. Last checked ${londonDate(new Date())}.`
void load()

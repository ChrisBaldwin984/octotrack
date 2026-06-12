import '@fontsource-variable/archivo'
import '@fontsource-variable/spline-sans-mono'
import './style.css'

import type { Chart } from 'chart.js'
import { getStandingCharges, getUnitRates, type Rate } from './api.ts'
import { COLORS, priceChart, type Series } from './charts.ts'
import { addDays, londonDate, shortDay, todayLondon } from './dates.ts'
import { dailyRateMap, directDebitOnly, rateOn } from './pricing.ts'
import { CAPS, DEFAULT_VERSION, FLEX_PRODUCT, REGIONS, TRACKER_VERSIONS, versionByCode, type Fuel } from './products.ts'
import { settings } from './storage.ts'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

const regionSel = $<HTMLSelectElement>('#region')
const versionSel = $<HTMLSelectElement>('#version')
const statusEl = $('#status')
const cardsEl = $('#cards')
const standingEl = $('#standing')
const chartCanvas = $<HTMLCanvasElement>('#price-chart')
const rangeBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-range]')]

let chart: Chart | null = null
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
    const [elecRates, gasRates, flexElec, flexGas, scElec, scGas] = await Promise.all([
      getUnitRates(version.code, 'electricity', region, version.from),
      getUnitRates(version.code, 'gas', region, version.from),
      getUnitRates(FLEX_PRODUCT, 'electricity', region),
      getUnitRates(FLEX_PRODUCT, 'gas', region),
      getStandingCharges(version.code, 'electricity', region),
      getStandingCharges(version.code, 'gas', region),
    ])

    loaded = {
      elec: dailyRateMap(elecRates),
      gas: dailyRateMap(gasRates),
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

  const series: Series[] = [
    { label: 'Tracker electricity', data: dates.map((d) => loaded!.elec.get(d) ?? null), color: COLORS.elec, fill: true },
    { label: 'Tracker gas', data: dates.map((d) => loaded!.gas.get(d) ?? null), color: COLORS.gas, fill: true },
    { label: 'Flexible electricity', data: dates.map((d) => rateOn(loaded!.flexElec, d)), color: COLORS.flex, dashed: true },
    { label: 'Flexible gas', data: dates.map((d) => rateOn(loaded!.flexGas, d)), color: '#7d6b8c', dashed: true },
  ]

  chart?.destroy()
  chart = priceChart(chartCanvas, labels, series, 'p')
  applyRange()
}

function applyRange(): void {
  if (!chart) return
  const n = chart.data.labels?.length ?? 0
  const x = chart.options.scales!.x as { min?: number; max?: number }
  x.min = range > 0 ? Math.max(0, n - range) : 0
  x.max = n - 1
  chart.update()
}

$('#updated').textContent = `Prices include VAT. Last checked ${londonDate(new Date())}.`
void load()

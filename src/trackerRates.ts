// A long date range can span several Tracker products (Octopus replaces the
// product every few months). Stitch daily rates and standing charges across
// whichever product applied on each day — from the user's real agreements
// when available, or the products' public availability windows otherwise.

import { getStandingCharges, getUnitRates, type Agreement } from './api.ts'
import { addDays, londonDate } from './dates.ts'
import { dailyRateMap, directDebitOnly, rateOn } from './pricing.ts'
import { TRACKER_VERSIONS, type Fuel } from './products.ts'

export interface TrackerWindow {
  product: string
  from: string
  to: string | null
}

export function windowsFromAgreements(agreements: Agreement[]): TrackerWindow[] {
  return agreements
    .filter((a) => a.tariff_code.includes('SILVER'))
    .map((a) => ({
      product: a.tariff_code.replace(/^[EG]-1R-/, '').replace(/-[A-P]$/, ''),
      from: londonDate(a.valid_from),
      to: a.valid_to ? londonDate(a.valid_to) : null,
    }))
}

export function versionWindows(): TrackerWindow[] {
  return TRACKER_VERSIONS.map((v) => ({ product: v.code, from: v.from, to: v.to }))
}

/** Region letter from a tariff code like E-1R-SILVER-26-04-01-H, or null. */
export function regionFromTariffCode(code: string): string | null {
  const m = /-([A-P])$/.exec(code)
  return m ? m[1] : null
}

export interface TrackerRates {
  rates: Map<string, number>
  standing: Map<string, number>
}

function clampedWindows(windows: TrackerWindow[], from: string, to: string) {
  return windows
    .filter((w) => (w.to === null || w.to > from) && w.from <= to)
    .map((w) => ({
      product: w.product,
      start: w.from > from ? w.from : from,
      end: w.to !== null && w.to < to ? w.to : to,
    }))
}

/** Daily unit rates stitched across whichever Tracker product applied on each day. */
export async function stitchedUnitRates(
  fuel: Fuel,
  region: string,
  from: string,
  to: string,
  windows: TrackerWindow[],
): Promise<Map<string, number>> {
  const rates = new Map<string, number>()
  await Promise.all(
    clampedWindows(windows, from, to).map(async (w) => {
      const unit = await getUnitRates(w.product, fuel, region, w.start, w.end)
      for (const [d, v] of dailyRateMap(unit)) {
        if (d >= w.start && d <= w.end) rates.set(d, v)
      }
    }),
  )
  return rates
}

export async function stitchedTracker(
  fuel: Fuel,
  region: string,
  from: string,
  to: string,
  windows: TrackerWindow[],
): Promise<TrackerRates> {
  const standing = new Map<string, number>()
  const [rates] = await Promise.all([
    stitchedUnitRates(fuel, region, from, to, windows),
    ...clampedWindows(windows, from, to).map(async (w) => {
      const sc = await getStandingCharges(w.product, fuel, region)
      const scDd = directDebitOnly(sc)
      for (let d = w.start; d <= w.end; d = addDays(d, 1)) {
        const v = rateOn(scDd, d)
        if (v !== null) standing.set(d, v)
      }
    }),
  ])
  return { rates, standing }
}

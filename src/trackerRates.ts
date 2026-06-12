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

export async function stitchedTracker(
  fuel: Fuel,
  region: string,
  from: string,
  to: string,
  windows: TrackerWindow[],
): Promise<TrackerRates> {
  const rates = new Map<string, number>()
  const standing = new Map<string, number>()
  const overlapping = windows.filter((w) => (w.to === null || w.to > from) && w.from <= to)

  await Promise.all(
    overlapping.map(async (w) => {
      const start = w.from > from ? w.from : from
      const end = w.to !== null && w.to < to ? w.to : to
      const [unit, sc] = await Promise.all([
        getUnitRates(w.product, fuel, region, start, end),
        getStandingCharges(w.product, fuel, region),
      ])
      for (const [d, v] of dailyRateMap(unit)) {
        if (d >= start && d <= end) rates.set(d, v)
      }
      const scDd = directDebitOnly(sc)
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const v = rateOn(scDd, d)
        if (v !== null) standing.set(d, v)
      }
    }),
  )
  return { rates, standing }
}

import type { Rate } from './api.ts'
import { londonDate } from './dates.ts'

/**
 * Tracker rates are one-per-day (midnight to midnight UK time).
 * Map each rate to the local calendar date it applies to.
 */
export function dailyRateMap(rates: Rate[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rates) {
    map.set(londonDate(r.valid_from), r.value_inc_vat)
  }
  return map
}

/**
 * Flexible/standing rates are long validity windows. Keep only direct-debit
 * rows (the API returns DD and non-DD variants; null means single price).
 */
export function directDebitOnly(rates: Rate[]): Rate[] {
  const dd = rates.filter((r) => r.payment_method === 'DIRECT_DEBIT')
  return dd.length > 0 ? dd : rates.filter((r) => r.payment_method === null)
}

/** Find the rate in force on a given UK calendar date. */
export function rateOn(rates: Rate[], date: string): number | null {
  const ts = date + 'T12:00:00Z'
  for (const r of rates) {
    if (r.valid_from <= ts && (r.valid_to === null || ts < r.valid_to)) {
      return r.value_inc_vat
    }
  }
  return null
}

export interface DayCost {
  date: string
  kwh: number
  trackerRate: number
  flexRate: number
  /** pence, unit cost + standing charge */
  trackerCost: number
  flexCost: number
  /** pence saved vs Flexible (positive = Tracker cheaper) */
  saved: number
}

export interface FuelSavings {
  days: DayCost[]
  totalSaved: number
  totalTrackerCost: number
  totalFlexCost: number
  totalKwh: number
}

export function computeSavings(
  usage: Map<string, number>,
  trackerRates: Map<string, number>,
  trackerStanding: Rate[],
  flexRates: Rate[],
  flexStanding: Rate[],
): FuelSavings {
  const days: DayCost[] = []
  for (const [date, kwh] of [...usage.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const trackerRate = trackerRates.get(date)
    const flexRate = rateOn(flexRates, date)
    const trSc = rateOn(trackerStanding, date)
    const flSc = rateOn(flexStanding, date)
    if (trackerRate == null || flexRate == null || trSc == null || flSc == null) continue
    const trackerCost = kwh * trackerRate + trSc
    const flexCost = kwh * flexRate + flSc
    days.push({ date, kwh, trackerRate, flexRate, trackerCost, flexCost, saved: flexCost - trackerCost })
  }
  const sum = (f: (d: DayCost) => number) => days.reduce((a, d) => a + f(d), 0)
  return {
    days,
    totalSaved: sum((d) => d.saved),
    totalTrackerCost: sum((d) => d.trackerCost),
    totalFlexCost: sum((d) => d.flexCost),
    totalKwh: sum((d) => d.kwh),
  }
}

export function pence(p: number): string {
  const pounds = Math.abs(p) / 100
  return `${p < 0 ? '−' : ''}£${pounds.toFixed(2)}`
}

// Synthetic household consumption for "try it without my details" mode.
// Deterministic so everyone sees the same demo.

import { addDays, todayLondon } from './dates.ts'

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Daily kWh from `from` to yesterday, seasonal shape + noise. */
export function demoUsage(from: string, fuel: 'electricity' | 'gas'): Map<string, number> {
  const rand = mulberry32(fuel === 'electricity' ? 84 : 19)
  const out = new Map<string, number>()
  const end = addDays(todayLondon(), -1)
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const doy = (Date.parse(d) / 86400000) % 365.25
    // winter peak around day 15 (mid-Jan)
    const winter = (Math.cos(((doy - 15) / 365.25) * 2 * Math.PI) + 1) / 2
    const kwh =
      fuel === 'electricity'
        ? 7.5 + 4 * winter + rand() * 3
        : 4 + 38 * winter ** 1.6 + rand() * 4
    out.set(d, Math.round(kwh * 100) / 100)
  }
  return out
}

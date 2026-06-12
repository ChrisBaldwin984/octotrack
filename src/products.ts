export type Fuel = 'electricity' | 'gas'

export interface TrackerVersion {
  code: string
  name: string
  /** First day the product was live (YYYY-MM-DD) */
  from: string
  /** Day the product closed to new joins, null if still open */
  to: string | null
}

/** Verified against api.octopus.energy on 2026-06-12, newest first. */
export const TRACKER_VERSIONS: TrackerVersion[] = [
  { code: 'SILVER-26-04-01', name: 'April 2026 v1', from: '2026-04-01', to: null },
  { code: 'SILVER-25-09-02', name: 'September 2025 v1', from: '2025-09-02', to: '2026-04-01' },
  { code: 'SILVER-25-04-15', name: 'April 2025 v2', from: '2025-04-15', to: '2025-09-02' },
  { code: 'SILVER-25-04-11', name: 'April 2025 v1', from: '2025-04-11', to: '2025-04-15' },
  { code: 'SILVER-24-12-31', name: 'December 2024 v1', from: '2024-12-31', to: '2025-04-11' },
  { code: 'SILVER-24-10-01', name: 'October 2024 v1', from: '2024-10-01', to: '2024-12-31' },
  { code: 'SILVER-24-07-01', name: 'July 2024 v1', from: '2024-07-01', to: '2024-10-01' },
  { code: 'SILVER-24-04-03', name: 'April 2024 v1', from: '2024-04-03', to: '2024-07-01' },
  { code: 'SILVER-23-12-06', name: 'December 2023 v1', from: '2023-12-11', to: '2024-04-03' },
  { code: 'SILVER-FLEX-22-11-25', name: 'November 2022 v1', from: '2022-11-25', to: '2023-12-11' },
]

export const DEFAULT_VERSION = TRACKER_VERSIONS[0]

/** Flexible Octopus (standard variable tariff) used as the savings baseline. */
export const FLEX_PRODUCT = 'VAR-22-11-01'

/** GSP region letter -> friendly name. */
export const REGIONS: Record<string, string> = {
  A: 'Eastern England',
  B: 'East Midlands',
  C: 'London',
  D: 'Merseyside & North Wales',
  E: 'West Midlands',
  F: 'North East England',
  G: 'North West England',
  H: 'Southern England',
  J: 'South East England',
  K: 'South Wales',
  L: 'South West England',
  M: 'Yorkshire',
  N: 'South & Central Scotland',
  P: 'North Scotland',
}

/** Tracker price caps, p/kWh inc VAT. */
export const CAPS: Record<Fuel, number> = { electricity: 100, gas: 30 }

export function tariffCode(product: string, fuel: Fuel, region: string): string {
  return `${fuel === 'electricity' ? 'E-1R' : 'G-1R'}-${product}-${region}`
}

export function versionByCode(code: string): TrackerVersion {
  return TRACKER_VERSIONS.find((v) => v.code === code) ?? DEFAULT_VERSION
}

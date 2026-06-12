import { tariffCode, type Fuel } from './products.ts'

const BASE = 'https://api.octopus.energy/v1'

export interface Rate {
  value_exc_vat: number
  value_inc_vat: number
  valid_from: string
  valid_to: string | null
  payment_method: string | null
}

export interface ConsumptionRow {
  consumption: number
  interval_start: string
  interval_end: string
}

export interface MeterPoint {
  fuel: Fuel
  mpxn: string
  serials: string[]
}

export interface AccountInfo {
  meterPoints: MeterPoint[]
  /** valid_from of the most recent Tracker (SILVER) agreement, if any */
  trackerSince: string | null
}

interface Paged<T> {
  count: number
  next: string | null
  results: T[]
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function getJson<T>(url: string, apiKey?: string): Promise<T> {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = 'Basic ' + btoa(apiKey + ':')
  let res: Response
  try {
    res = await fetch(url, { headers })
  } catch {
    throw new ApiError(0, 'Could not reach the Octopus API — check your connection.')
  }
  if (!res.ok) {
    const msg =
      res.status === 401 || res.status === 403
        ? 'Octopus rejected those details — double-check your API key.'
        : res.status === 404
          ? 'Not found — double-check your account number.'
          : `Octopus API error (HTTP ${res.status}).`
    throw new ApiError(res.status, msg)
  }
  return res.json() as Promise<T>
}

async function getAllPages<T>(url: string, apiKey?: string): Promise<T[]> {
  const out: T[] = []
  let next: string | null = url
  while (next) {
    const page: Paged<T> = await getJson<Paged<T>>(next, apiKey)
    out.push(...page.results)
    next = page.next
  }
  return out
}

function tariffPath(product: string, fuel: Fuel, region: string): string {
  const kind = fuel === 'electricity' ? 'electricity-tariffs' : 'gas-tariffs'
  return `${BASE}/products/${product}/${kind}/${tariffCode(product, fuel, region)}`
}

export function getUnitRates(
  product: string,
  fuel: Fuel,
  region: string,
  periodFrom?: string,
): Promise<Rate[]> {
  let url = `${tariffPath(product, fuel, region)}/standard-unit-rates/?page_size=1500`
  if (periodFrom) url += `&period_from=${periodFrom}T00:00:00Z`
  return getAllPages<Rate>(url)
}

export function getStandingCharges(product: string, fuel: Fuel, region: string): Promise<Rate[]> {
  return getAllPages<Rate>(`${tariffPath(product, fuel, region)}/standing-charges/?page_size=1500`)
}

export async function getAccount(apiKey: string, account: string): Promise<AccountInfo> {
  interface RawAgreement {
    tariff_code: string
    valid_from: string
    valid_to: string | null
  }
  interface RawAccount {
    properties: Array<{
      electricity_meter_points?: Array<{
        mpan: string
        is_export: boolean
        meters: Array<{ serial_number: string }>
        agreements: RawAgreement[]
      }>
      gas_meter_points?: Array<{
        mprn: string
        meters: Array<{ serial_number: string }>
        agreements: RawAgreement[]
      }>
    }>
  }

  const raw = await getJson<RawAccount>(`${BASE}/accounts/${account.trim()}/`, apiKey)
  const meterPoints: MeterPoint[] = []
  let trackerSince: string | null = null

  for (const prop of raw.properties ?? []) {
    for (const mp of prop.electricity_meter_points ?? []) {
      if (mp.is_export) continue
      meterPoints.push({
        fuel: 'electricity',
        mpxn: mp.mpan,
        serials: mp.meters.map((m) => m.serial_number).filter(Boolean),
      })
      for (const ag of mp.agreements ?? []) {
        if (ag.tariff_code.includes('SILVER') && (!trackerSince || ag.valid_from > trackerSince)) {
          trackerSince = ag.valid_from
        }
      }
    }
    for (const mp of prop.gas_meter_points ?? []) {
      meterPoints.push({
        fuel: 'gas',
        mpxn: mp.mprn,
        serials: mp.meters.map((m) => m.serial_number).filter(Boolean),
      })
    }
  }

  if (meterPoints.length === 0) {
    throw new ApiError(404, 'No meters found on that account.')
  }
  return { meterPoints, trackerSince }
}

export function getDailyConsumption(
  apiKey: string,
  fuel: Fuel,
  mpxn: string,
  serial: string,
  periodFrom: string,
  periodTo: string,
): Promise<ConsumptionRow[]> {
  const kind = fuel === 'electricity' ? 'electricity-meter-points' : 'gas-meter-points'
  const url =
    `${BASE}/${kind}/${mpxn}/meters/${encodeURIComponent(serial)}/consumption/` +
    `?group_by=day&order_by=period&page_size=1500` +
    `&period_from=${periodFrom}T00:00:00Z&period_to=${periodTo}T23:59:59Z`
  return getAllPages<ConsumptionRow>(url, apiKey)
}

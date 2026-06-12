// Everything the user gives us lives here, in their browser's localStorage,
// and nowhere else. No cookies, no server, no analytics.

const PREFIX = 'octotrack:'

function get(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    /* private browsing / storage full — degrade silently */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}

export const settings = {
  get region(): string {
    return get('region') ?? 'A'
  },
  set region(v: string) {
    set('region', v)
  },

  get version(): string {
    return get('version') ?? ''
  },
  set version(v: string) {
    set('version', v)
  },

  get apiKey(): string {
    return get('apiKey') ?? ''
  },
  set apiKey(v: string) {
    set('apiKey', v)
  },

  get account(): string {
    return get('account') ?? ''
  },
  set account(v: string) {
    set('account', v)
  },

  /** 'm3' (SMETS2, needs conversion) or 'kwh' (SMETS1) */
  get gasUnits(): 'm3' | 'kwh' {
    return get('gasUnits') === 'kwh' ? 'kwh' : 'm3'
  },
  set gasUnits(v: 'm3' | 'kwh') {
    set('gasUnits', v)
  },

  get calorificValue(): number {
    const n = Number(get('calorific'))
    return Number.isFinite(n) && n >= 37 && n <= 43 ? n : 39.5
  },
  set calorificValue(v: number) {
    set('calorific', String(v))
  },
}

export function clearCredentials(): void {
  remove('apiKey')
  remove('account')
}

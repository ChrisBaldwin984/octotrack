const LONDON_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** ISO timestamp -> calendar date (YYYY-MM-DD) in UK local time. */
export function londonDate(iso: string | Date): string {
  return LONDON_FMT.format(typeof iso === 'string' ? new Date(iso) : iso)
}

export function todayLondon(): string {
  return londonDate(new Date())
}

/** YYYY-MM-DD plus n days (calendar arithmetic, DST-safe at noon). */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** "2026-06-12" -> "Fri 12 Jun" */
export function shortDay(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** "2026-06-12" -> "12 Jun 2026" */
export function longDay(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'

Chart.register(LineController, LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip, Legend)

export const COLORS = {
  elec: '#c8f04b',
  gas: '#ffb454',
  flex: '#5a6b8c',
  saved: '#c8f04b',
  lost: '#ff6b81',
  grid: 'rgba(120, 140, 180, 0.12)',
  tick: '#8b97ad',
}

Chart.defaults.font.family = "'Spline Sans Mono Variable', ui-monospace, monospace"
Chart.defaults.font.size = 11
Chart.defaults.color = COLORS.tick

const baseScales = {
  x: {
    grid: { color: COLORS.grid },
    ticks: { maxTicksLimit: 8, maxRotation: 0 },
  },
  y: {
    grid: { color: COLORS.grid },
    border: { display: false },
  },
}

export interface Series {
  label: string
  data: (number | null)[]
  color: string
  dashed?: boolean
  fill?: boolean
}

export function priceChart(canvas: HTMLCanvasElement, labels: string[], series: Series[], unit: string): Chart {
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: s.fill ? s.color + '22' : s.color,
        borderWidth: 2,
        borderDash: s.dashed ? [6, 4] : undefined,
        pointRadius: 0,
        pointHitRadius: 12,
        fill: s.fill ?? false,
        tension: 0.25,
        spanGaps: true,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { boxWidth: 14, boxHeight: 2, padding: 16 } },
        tooltip: {
          backgroundColor: '#141d33',
          borderColor: 'rgba(120,140,180,0.25)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${(ctx.parsed.y as number).toFixed(2)}${unit}`,
          },
        },
      },
      scales: {
        ...baseScales,
        y: {
          ...baseScales.y,
          ticks: { callback: (v) => `${v}${unit}` },
        },
      },
    },
  })
}

export function savingsChart(canvas: HTMLCanvasElement, labels: string[], cumulativePounds: number[]): Chart {
  const last = cumulativePounds[cumulativePounds.length - 1] ?? 0
  const color = last >= 0 ? COLORS.saved : COLORS.lost
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Cumulative saving vs Flexible',
          data: cumulativePounds,
          borderColor: color,
          backgroundColor: color + '26',
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 12,
          fill: 'origin',
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#141d33',
          borderColor: 'rgba(120,140,180,0.25)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y as number
              return ` ${v >= 0 ? 'Saved' : 'Lost'} £${Math.abs(v).toFixed(2)} so far`
            },
          },
        },
      },
      scales: {
        ...baseScales,
        y: {
          ...baseScales.y,
          ticks: { callback: (v) => `£${v}` },
        },
      },
    },
  })
}

import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import zoomPlugin from 'chartjs-plugin-zoom'

Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend,
  zoomPlugin,
)

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

const tooltipStyle = {
  backgroundColor: '#141d33',
  borderColor: 'rgba(120,140,180,0.25)',
  borderWidth: 1,
  padding: 12,
}

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
  /** 'y2' puts the series on a separate right-hand axis (e.g. gas alongside electricity) */
  axis?: 'y' | 'y2'
}

export function priceChart(canvas: HTMLCanvasElement, labels: string[], series: Series[], unit: string): Chart {
  const dualAxis = series.some((s) => s.axis === 'y2')

  const scales: Record<string, object> = {
    x: baseScales.x,
    y: {
      ...baseScales.y,
      ticks: {
        callback: (v: number | string) => `${v}${unit}`,
        color: dualAxis ? COLORS.elec : COLORS.tick,
      },
    },
  }
  if (dualAxis) {
    scales.y2 = {
      position: 'right',
      grid: { drawOnChartArea: false },
      border: { display: false },
      ticks: {
        callback: (v: number | string) => `${v}${unit}`,
        color: COLORS.gas,
      },
    }
  }

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s) => ({
        label: s.label,
        data: s.data,
        yAxisID: s.axis ?? 'y',
        borderColor: s.color,
        backgroundColor: s.fill ? s.color + '22' : s.color,
        borderWidth: 2,
        borderDash: s.dashed ? [6, 4] : undefined,
        pointRadius: 0,
        pointHitRadius: 12,
        fill: s.fill ?? false,
        stepped: true,
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
          ...tooltipStyle,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${(ctx.parsed.y as number).toFixed(2)}${unit}`,
          },
        },
        zoom: {
          pan: { enabled: true, mode: 'x' },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'x',
          },
          limits: { x: { min: 'original', max: 'original', minRange: 4 } },
        },
      },
      scales,
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
          ...tooltipStyle,
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

/** One row per period: costs in pounds. Bar = Tracker cost, dashed marker = Flexible cost. */
export interface CostRow {
  label: string
  tracker: number
  flex: number
  saved: number
}

export function costBars(canvas: HTMLCanvasElement, rows: CostRow[], accent: string): Chart {
  const markers = {
    id: 'costMarkers',
    afterDatasetsDraw(chart: Chart) {
      const { ctx } = chart
      const meta = chart.getDatasetMeta(0)
      const xScale = chart.scales.x
      ctx.save()
      ctx.font = "600 12px 'Spline Sans Mono Variable', ui-monospace, monospace"
      ctx.textBaseline = 'middle'
      rows.forEach((r, i) => {
        const bar = meta.data[i] as unknown as { y: number; height?: number }
        if (!bar) return
        const y = bar.y
        const h = bar.height ?? 18
        const sign = r.saved >= 0 ? '+' : '−'
        ctx.fillStyle = r.saved >= 0 ? '#e3ffa8' : '#ffb3c0'
        ctx.fillText(`${sign}£${Math.abs(r.saved).toFixed(2)}`, xScale.left + 8, y)
        const fx = xScale.getPixelForValue(r.flex)
        ctx.strokeStyle = 'rgba(255, 214, 110, 0.9)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(fx, y - h / 2 - 3)
        ctx.lineTo(fx, y + h / 2 + 3)
        ctx.stroke()
        ctx.setLineDash([])
      })
      ctx.restore()
    },
  }

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.label),
      datasets: [
        {
          data: rows.map((r) => r.tracker),
          backgroundColor: accent + '4d',
          borderColor: accent,
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: 0.78,
          categoryPercentage: 0.9,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipStyle,
          callbacks: {
            title: (items) => rows[items[0].dataIndex].label,
            label: (ctx) => {
              const r = rows[ctx.dataIndex]
              return [
                ` Tracker: £${r.tracker.toFixed(2)}`,
                ` Flexible: £${r.flex.toFixed(2)}`,
                ` ${r.saved >= 0 ? 'Saved' : 'Lost'}: £${Math.abs(r.saved).toFixed(2)}`,
              ]
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: COLORS.grid },
          ticks: { callback: (v) => `£${v}` },
          beginAtZero: true,
        },
        y: {
          grid: { display: false },
          border: { display: false },
        },
      },
    },
    plugins: [markers],
  })
}

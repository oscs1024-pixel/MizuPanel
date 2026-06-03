import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { formatPercent, formatSpeed } from '../lib/format'
import type { Metric } from '../types'

type MetricKey = keyof Pick<Metric, 'cpu_usage' | 'memory_usage' | 'disk_usage' | 'disk_read_speed' | 'disk_write_speed' | 'rx_speed' | 'tx_speed' | 'load1' | 'load5' | 'load15'>
type ChartRange = '1h' | '6h'

type ChartSeries = {
  dataKey: MetricKey
  label: string
  color: string
  unitLabel?: string
}

type ChartSummaryItem = {
  label?: string
  value: string
  color?: string
}

type MetricsChartProps = {
  metrics: Metric[]
  dataKey?: MetricKey
  series?: ChartSeries[]
  summaryItems?: ChartSummaryItem[]
  title: string
  color: string
  unitLabel?: string
  domain?: [number, number | 'auto']
  range?: ChartRange
  onRangeChange?: (range: ChartRange) => void
  emptyText?: string
}

function cssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value ? `rgb(${value})` : fallback
}

const chartVarByKey: Partial<Record<MetricKey, string>> = {
  cpu_usage: '--chart-cpu',
  memory_usage: '--chart-memory',
  disk_usage: '--chart-disk',
  disk_read_speed: '--chart-network-out',
  disk_write_speed: '--chart-network-in',
  rx_speed: '--chart-network-in',
  tx_speed: '--chart-network-out',
  load1: '--chart-load',
  load5: '--chart-memory',
  load15: '--chart-network-out'
}

export function MetricsChart({ metrics, dataKey, series, summaryItems = [], title, color, unitLabel = '使用率 %', domain = [0, 100], range, onRangeChange, emptyText = '等待指标数据' }: MetricsChartProps) {
  const chartSeries = series?.length ? series : dataKey ? [{ dataKey, label: title, color, unitLabel }] : []
  const latestMetric = metrics.length > 0 ? metrics[metrics.length - 1] : undefined
  const defaultSummaryItems = summaryItems.length > 0
    ? summaryItems
    : chartSeries.length === 1 && latestMetric
      ? [{ value: formatChartValue(latestMetric[chartSeries[0].dataKey], chartSeries[0].unitLabel || unitLabel) }]
      : []
  const data = metrics.map((metric) => {
    const row: Record<string, number | string | undefined> = {
      time: new Date(metric.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    chartSeries.forEach((item) => {
      const value = metric[item.dataKey]
      row[item.dataKey] = typeof value === 'number' && Number.isFinite(value) ? value : undefined
    })
    return row
  })
  const hasChartData = data.some((row) => chartSeries.some((item) => typeof row[item.dataKey] === 'number' && Number.isFinite(row[item.dataKey])))
  const gridColor = cssVar('--chart-grid', '#e2e8f0')
  const tooltipBackground = cssVar('--chart-tooltip', '#ffffff')
  const tooltipText = cssVar('--foreground', '#0f172a')
  const tooltipBorder = cssVar('--border', '#e2e8f0')
  const tickColor = cssVar('--muted-foreground', '#64748b')

  return (
    <section aria-label={title} className="rounded-[14px] border border-border bg-card p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-black text-foreground">{title}</h3>
        </div>
        {range && onRangeChange ? (
          <div className="flex rounded-xl border border-border bg-surface p-1" aria-label={`${title} 时间范围`}>
            {(['1h', '6h'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={range === item}
                onClick={() => onRangeChange(item)}
                className={`min-h-7 cursor-pointer rounded-lg px-2.5 text-[11px] font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${range === item ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-card hover:text-foreground'}`}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mb-2 flex min-h-10 flex-wrap items-end gap-x-4 gap-y-1">
        {defaultSummaryItems.length > 0 ? defaultSummaryItems.map((item, index) => (
          <div key={`${item.label || 'summary'}-${index}`} className="min-w-0">
            {item.label ? <p className="text-[11px] font-black text-muted-foreground">{item.label}</p> : null}
            <p className={`${defaultSummaryItems.length === 1 ? 'text-[32px]' : 'text-sm'} font-black leading-none text-foreground`} style={item.color ? { color: item.color } : undefined}>{item.value}</p>
          </div>
        )) : chartSeries.length === 1 ? (
          <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-black text-muted-foreground">{chartSeries[0].unitLabel || unitLabel}</span>
        ) : chartSeries.map((item) => (
          <span key={item.dataKey} className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-black text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cssVar(chartVarByKey[item.dataKey] ?? '', item.color) }} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="h-40">
        {data.length === 0 || chartSeries.length === 0 || !hasChartData ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border bg-surface px-4 text-center text-sm font-black text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
              <defs>
                {chartSeries.map((item) => {
                  const strokeColor = cssVar(chartVarByKey[item.dataKey] ?? '', item.color)
                  return (
                    <linearGradient key={item.dataKey} id={`${String(item.dataKey)}Gradient`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={strokeColor} stopOpacity={0.04} />
                    </linearGradient>
                  )
                })}
              </defs>
              <CartesianGrid stroke={gridColor} strokeDasharray="4 8" vertical={false} />
              <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: tickColor, fontSize: 12, fontWeight: 700 }} />
              <YAxis domain={domain} tickLine={false} axisLine={false} tick={{ fill: tickColor, fontSize: 12, fontWeight: 700 }} />
              <Tooltip contentStyle={{ borderRadius: 14, border: `1px solid ${tooltipBorder}`, background: tooltipBackground, color: tooltipText, boxShadow: '0 18px 50px rgb(0 0 0 / 0.16)' }} />
              {chartSeries.map((item) => {
                const strokeColor = cssVar(chartVarByKey[item.dataKey] ?? '', item.color)
                return (
                  <Area
                    key={item.dataKey}
                    type="monotone"
                    dataKey={item.dataKey}
                    name={item.label}
                    stroke={strokeColor}
                    strokeWidth={3}
                    fill={`url(#${String(item.dataKey)}Gradient)`}
                    fillOpacity={1}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                )
              })}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

function formatChartValue(value: number | undefined, unitLabel: string) {
  if (unitLabel.includes('bytes/s')) return formatSpeed(value)
  if (unitLabel.includes('%')) return formatPercent(value)
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—'
}

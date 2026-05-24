import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { Metric } from '../types'

type MetricsChartProps = {
  metrics: Metric[]
  dataKey: keyof Pick<Metric, 'cpu_usage' | 'memory_usage' | 'disk_usage' | 'rx_speed' | 'tx_speed'>
  title: string
  color: string
  unitLabel?: string
  domain?: [number, number | 'auto']
}

export function MetricsChart({ metrics, dataKey, title, color, unitLabel = '使用率 %', domain = [0, 100] }: MetricsChartProps) {
  const data = metrics.map((metric) => ({
    time: new Date(metric.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: Number(metric[dataKey] ?? 0)
  }))

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="font-display text-lg font-black text-slate-950">{title}</h3>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-500">{unitLabel}</span>
      </div>
      <div className="h-48">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50 text-sm font-black text-slate-400">
            等待指标数据
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={`${String(dataKey)}Gradient`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 8" vertical={false} />
              <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 700 }} />
              <YAxis domain={domain} tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 12, fontWeight: 700 }} />
              <Tooltip contentStyle={{ borderRadius: 18, border: '1px solid #e2e8f0', background: '#ffffff', color: '#0f172a', boxShadow: '0 18px 50px rgba(15, 23, 42, 0.12)' }} />
              <Area type="monotone" dataKey="value" stroke={color} strokeWidth={3} fill={`url(#${String(dataKey)}Gradient)`} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

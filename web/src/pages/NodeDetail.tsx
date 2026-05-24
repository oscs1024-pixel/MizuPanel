import type { Metric, Node, RangeOption } from '../types'
import { formatBytes, formatPercent, formatSpeed } from '../lib/format'
import { MetricCard } from '../components/MetricCard'
import { MetricsChart } from '../components/MetricsChart'

type NodeDetailProps = {
  node?: Node
  metrics: Metric[]
  range: RangeOption
  onRangeChange: (range: RangeOption) => void
}

export function NodeDetail({ node, metrics, range, onRangeChange }: NodeDetailProps) {
  if (!node) {
    return null
  }

  const metric = node.latest_metric

  return (
    <section className="space-y-3">
      <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-500">节点详情</p>
            <h2 className="mt-1 truncate font-display text-3xl font-black tracking-tight text-slate-950">{node.name || node.hostname}</h2>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {node.hostname || '未知主机'} · {node.ip || '未知 IP'} · {node.os}/{node.arch} · 内核 {node.kernel || '未知'}
            </p>
          </div>
          <div className="flex w-fit rounded-2xl border border-slate-200 bg-slate-50 p-1">
            {(['1h', '6h'] as RangeOption[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onRangeChange(option)}
                className={`min-h-10 cursor-pointer rounded-xl px-4 text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                  range === option ? 'bg-slate-950 text-white shadow-md shadow-slate-200' : 'text-slate-500 hover:bg-white hover:text-slate-950'
                }`}
              >
                {option === '1h' ? '1 小时' : '6 小时'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">概览</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">硬件概览</h3>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">最新采样</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="CPU" value={metric ? formatPercent(metric.cpu_usage) : '—'} detail={metric ? `${metric.cpu_cores} 核` : '等待 Agent'} />
          <MetricCard label="内存" value={metric ? formatPercent(metric.memory_usage) : '—'} tone="green" detail={metric ? `${formatBytes(metric.memory_used)} / ${formatBytes(metric.memory_total)}` : '等待 Agent'} />
          <MetricCard label="磁盘" value={metric ? formatPercent(metric.disk_usage) : '—'} tone="amber" detail={metric ? `${formatBytes(metric.disk_used)} / ${formatBytes(metric.disk_total)}` : '等待 Agent'} />
          <MetricCard label="网络" value={metric ? formatSpeed(metric.rx_speed) : '—'} tone="slate" detail={metric ? `上行 ${formatSpeed(metric.tx_speed)}` : '等待 Agent'} />
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <MetricsChart metrics={metrics} dataKey="cpu_usage" title="负载趋势" color="#2563eb" />
        <MetricsChart metrics={metrics} dataKey="memory_usage" title="内存曲线" color="#059669" />
        <MetricsChart metrics={metrics} dataKey="disk_usage" title="磁盘曲线" color="#d97706" />
        <MetricsChart metrics={metrics} dataKey="rx_speed" title="网络速率" color="#0284c7" unitLabel="bytes/s" domain={[0, 'auto']} />
      </div>
    </section>
  )
}

import type { Node } from '../types'
import { formatPercent, formatSpeed } from '../lib/format'

type NodeListProps = {
  nodes: Node[]
  selectedNodeID?: string
  onSelectNode: (node: Node) => void
}

export function NodeList({ nodes, selectedNodeID, onSelectNode }: NodeListProps) {
  return (
    <section className="rounded-[26px] border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-blue-500">节点列表</p>
          <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950">已接入服务器</h2>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-500">{nodes.length} 台</span>
      </div>
      <div className="space-y-2">
        {nodes.map((node) => {
          const metric = node.latest_metric
          const active = node.id === selectedNodeID
          const statusText = node.status === 'online' ? '在线' : '离线'
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node)}
              className={`group w-full cursor-pointer rounded-[22px] border p-3 text-left transition duration-200 focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                active ? 'border-blue-300 bg-blue-50/80 shadow-md shadow-blue-100/70' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${node.status === 'online' ? 'bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.55)]' : 'bg-slate-300'}`} />
                    <p className="truncate text-base font-black text-slate-950">{node.name || node.hostname}</p>
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold text-slate-500">{node.hostname || '未知主机'} · {node.ip || '未知 IP'} · {node.os}/{node.arch}</p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${node.status === 'online' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {statusText}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniStat label="CPU" value={metric ? formatPercent(metric.cpu_usage) : '—'} active={active} />
                <MiniStat label="内存" value={metric ? formatPercent(metric.memory_usage) : '—'} active={active} />
                <MiniStat label="磁盘" value={metric ? formatPercent(metric.disk_usage) : '—'} active={active} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-500">
                <span>下行 {metric ? formatSpeed(metric.rx_speed) : '—'}</span>
                <span>上行 {metric ? formatSpeed(metric.tx_speed) : '—'}</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function MiniStat({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={`rounded-2xl border px-3 py-2 ${active ? 'border-blue-100 bg-white' : 'border-slate-100 bg-slate-50'}`}>
      <p className="text-[10px] font-black tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-black text-slate-900">{value}</p>
    </div>
  )
}

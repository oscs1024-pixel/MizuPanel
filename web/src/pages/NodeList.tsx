import type { Node } from '../types'
import { formatPercent } from '../lib/format'

type NodeListProps = {
  nodes: Node[]
  selectedNodeID?: string
  onSelectNode: (node: Node) => void
}

export function NodeList({ nodes, selectedNodeID, onSelectNode }: NodeListProps) {
  return (
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
            className={`soft-button group w-full cursor-pointer border px-3 py-3 text-left duration-200 focus:outline-none focus:ring-4 focus:ring-primary/20 ${
              active ? 'border-primary/40 bg-primary/10 shadow-sm' : 'border-border bg-card hover:bg-surface'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${node.status === 'online' ? 'bg-success shadow-[0_0_14px_rgb(var(--success)/0.45)]' : 'bg-muted-foreground/40'}`} />
                  <p className="truncate text-sm font-black text-foreground">{node.name || node.hostname}</p>
                </div>
                <p className="mt-1 truncate text-xs font-semibold text-muted-foreground">{node.ip || '未知 IP'}</p>
                <p className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground">{node.hostname || '未知主机'} · {node.os}/{node.arch}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${node.status === 'online' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                {statusText}
              </span>
            </div>
            {active ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniStat label="CPU" value={metric ? formatPercent(metric.cpu_usage) : '—'} />
                <MiniStat label="内存" value={metric ? formatPercent(metric.memory_usage) : '—'} />
                <MiniStat label="磁盘" value={metric ? formatPercent(metric.disk_usage) : '—'} />
              </div>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-surface/70 px-2.5 py-2">
      <p className="text-[10px] font-black tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs font-black text-foreground">{value}</p>
    </div>
  )
}

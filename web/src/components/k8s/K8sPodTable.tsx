import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { K8sPod, K8sPodContainer, K8sResourceKind } from '../../types'
import { K8sResourceActions } from './K8sResourceActions'
import { K8sResourceTable } from './K8sResourceTable'
import { K8sStatusBadge } from './K8sStatusBadge'

type K8sPodTableProps = {
  clusterId: string
  items: K8sPod[]
  loading?: boolean
  onViewLogs: (namespace: string, name: string) => void
  onViewDiagnostics?: (kind: K8sResourceKind, namespace: string, name: string) => void
  onToast: (message: string, type: 'success' | 'error') => void
  onResourceChanged?: () => void
}

export function K8sPodTable({ clusterId, items, loading, onViewLogs, onViewDiagnostics, onToast, onResourceChanged }: K8sPodTableProps) {
  const [expandedKey, setExpandedKey] = useState<string>()

  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Pod"
      getKey={(item) => `${item.namespace}/${item.name}`}
      expandedKey={expandedKey}
      renderExpanded={(item) => <PodResourcePanel pod={item} />}
      columns={[
        {
          key: 'name',
          title: '名称',
          render: (item) => {
            const key = `${item.namespace}/${item.name}`
            const expanded = expandedKey === key
            return (
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${expanded ? '收起' : '展开'} Pod ${item.name} 资源观测`}
                onClick={() => setExpandedKey((current) => current === key ? undefined : key)}
                className="soft-button flex max-w-[190px] items-center gap-2 text-left font-black text-foreground hover:text-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
                title={item.name}
              >
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${expanded ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-surface text-muted-foreground'}`}>
                  {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                </span>
                <span className="truncate">{item.name}</span>
              </button>
            )
          }
        },
        { key: 'namespace', title: '命名空间', render: (item) => <span className="block max-w-[100px] truncate text-muted-foreground" title={item.namespace}>{item.namespace}</span> },
        { key: 'status', title: '状态', render: (item) => <K8sStatusBadge status={item.status} /> },
        { key: 'ready', title: 'Ready', render: (item) => <span className="text-muted-foreground">{item.ready}</span> },
        { key: 'restarts', title: '重启', render: (item) => <span className={item.restarts > 0 ? 'text-warning' : 'text-muted-foreground'}>{item.restarts}</span> },
        { key: 'node', title: '运行节点', render: (item) => <span className="text-muted-foreground">{item.node || '-'}</span> },
        { key: 'ip', title: 'Pod IP', render: (item) => <span className="text-muted-foreground">{item.ip || '-'}</span> },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
        {
          key: 'actions',
          title: '操作',
          align: 'center',
          render: (item) => (
            <K8sResourceActions
              clusterId={clusterId}
              kind="pod"
              namespace={item.namespace}
              name={item.name}
              onViewDiagnostics={onViewDiagnostics}
              onViewLogs={onViewLogs}
              onToast={onToast}
              onResourceChanged={onResourceChanged}
            />
          )
        },
      ]}
    />
  )
}

function PodResourcePanel({ pod }: { pod: K8sPod }) {
  const containers = pod.containers || []
  return (
    <section aria-label={`${pod.name} 资源观测`} className="soft-card border-primary/20 bg-primary/5 p-4">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-black text-foreground">容器资源</h3>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{pod.namespace} / {pod.name}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="soft-chip px-3 py-1 text-muted-foreground">CPU {formatCPU(pod.cpu_usage_milli, pod.metrics_available)}</span>
          <span className="soft-chip px-3 py-1 text-muted-foreground">内存 {formatPodBytes(pod.memory_usage_bytes, pod.metrics_available)}</span>
          {!pod.metrics_available ? <span className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-warning">Metrics 未上报</span> : null}
        </div>
      </div>

      {containers.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {containers.map((container) => (
            <ContainerResourceCard key={container.name} container={container} metricsAvailable={Boolean(pod.metrics_available)} />
          ))}
        </div>
      ) : (
        <div className="soft-empty-state px-4 py-5 text-sm font-bold text-muted-foreground">暂无容器资源明细。</div>
      )}
    </section>
  )
}

function ContainerResourceCard({ container, metricsAvailable }: { container: K8sPodContainer; metricsAvailable: boolean }) {
  return (
    <div className="rounded-2xl border border-border/85 bg-card/90 p-3">
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-foreground">{container.name}</p>
          <p className="mt-1 truncate text-xs font-bold text-muted-foreground" title={container.image || undefined}>{container.image || '未知镜像'}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <span className={`rounded-full px-2 py-1 text-[11px] font-black ${container.ready ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{container.ready ? 'Ready' : 'Not Ready'}</span>
          <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-black text-muted-foreground">{container.state || 'Unknown'}</span>
          <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-black text-muted-foreground">重启 {container.restart_count}</span>
        </div>
      </div>

      {container.state_reason ? <p className="mb-3 rounded-xl bg-warning/10 px-3 py-2 text-xs font-bold text-warning">{container.state_reason}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <ResourceMeter
          label="CPU"
          value={formatCPU(container.cpu_usage_milli, metricsAvailable)}
          request={`请求 ${formatCPU(container.cpu_request_milli, true)}`}
          limit={`限制 ${formatCPU(container.cpu_limit_milli, true)}`}
          percent={usagePercent(container.cpu_usage_milli, container.cpu_limit_milli)}
        />
        <ResourceMeter
          label="内存"
          value={formatPodBytes(container.memory_usage_bytes, metricsAvailable)}
          request={`请求 ${formatPodBytes(container.memory_request_bytes, true)}`}
          limit={`限制 ${formatPodBytes(container.memory_limit_bytes, true)}`}
          percent={usagePercent(container.memory_usage_bytes, container.memory_limit_bytes)}
        />
      </div>
    </div>
  )
}

function ResourceMeter({ label, value, request, limit, percent }: { label: string; value: string; request: string; limit: string; percent?: number }) {
  const width = percent === undefined ? 0 : Math.min(100, Math.max(0, percent))
  return (
    <div className="rounded-2xl border border-border/80 bg-surface/80 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-black text-muted-foreground">{label}</span>
        <span className="text-sm font-black text-foreground">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${width}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-black text-muted-foreground">
        <span>{request}</span>
        <span>{limit}</span>
      </div>
    </div>
  )
}

function usagePercent(usage?: number, limit?: number) {
  if (!usage || !limit || limit <= 0) return undefined
  return (usage / limit) * 100
}

function formatCPU(value?: number, available = true) {
  if (!available) return '未上报'
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '0m'
  return `${Math.round(value)}m`
}

function formatPodBytes(value?: number, available = true) {
  if (!available) return '未上报'
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** index
  const rounded = Math.round(scaled * 10) / 10
  const text = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)
  return `${text} ${units[index]}`
}

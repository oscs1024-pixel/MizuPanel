import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { K8sNode, K8sPod } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'
import { K8sStatusBadge } from './K8sStatusBadge'

type SortMode = 'memory' | 'cpu'

export function K8sNodeTable({ items, pods = [], loading }: { items: K8sNode[]; pods?: K8sPod[]; loading?: boolean }) {
  const [expandedKey, setExpandedKey] = useState<string>()
  const [sortMode, setSortMode] = useState<SortMode>('memory')

  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Node"
      getKey={(item) => item.name}
      expandedKey={expandedKey}
      renderExpanded={(item) => (
        <NodePodsPanel
          node={item}
          pods={pods.filter((pod) => pod.node === item.name)}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
        />
      )}
      columns={[
        {
          key: 'name',
          title: '名称',
          render: (item) => {
            const expanded = expandedKey === item.name
            return (
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${expanded ? '收起' : '展开'}节点 ${item.name} Pod 资源`}
                onClick={() => setExpandedKey((current) => current === item.name ? undefined : item.name)}
                className="soft-button flex max-w-[220px] items-center gap-2 text-left font-black text-foreground hover:text-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
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
        { key: 'status', title: '状态', render: (item) => <K8sStatusBadge status={item.status} /> },
        { key: 'roles', title: '角色', render: (item) => <span className="text-muted-foreground">{item.roles}</span> },
        { key: 'version', title: '版本', render: (item) => <span className="text-muted-foreground">{item.version}</span> },
        { key: 'internal_ip', title: 'Internal IP', render: (item) => <span className="text-muted-foreground">{item.internal_ip}</span> },
        { key: 'resources', title: '资源', render: (item) => <NodeResourceSummary node={item} pods={pods.filter((pod) => pod.node === item.name)} /> },
        { key: 'pods', title: 'Pods', render: (item) => <NodePodSummary node={item} pods={pods.filter((pod) => pod.node === item.name)} /> },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
      ]}
    />
  )
}

function NodeResourceSummary({ node, pods }: { node: K8sNode; pods: K8sPod[] }) {
  const usage = nodeUsage(pods)
  return (
    <div className="w-[170px] space-y-2">
      <CompactMeter label="CPU" value={`${formatCPU(usage.cpuUsageMilli)} / ${formatCPU(node.cpu_allocatable_milli, '未知')}`} percent={usagePercent(usage.cpuUsageMilli, node.cpu_allocatable_milli)} />
      <CompactMeter label="内存" value={`${formatBytes(usage.memoryUsageBytes)} / ${formatBytes(node.memory_allocatable_bytes, '未知')}`} percent={usagePercent(usage.memoryUsageBytes, node.memory_allocatable_bytes)} />
    </div>
  )
}

function NodePodSummary({ node, pods }: { node: K8sNode; pods: K8sPod[] }) {
  const reported = pods.filter((pod) => pod.metrics_available).length
  return (
    <div className="space-y-1">
      <p className="text-sm font-black text-foreground">{pods.length} Pods</p>
      <p className="text-xs font-bold text-muted-foreground">{reported}/{pods.length} 已上报</p>
      {node.pod_allocatable ? <p className="text-[11px] font-bold text-muted-foreground">可调度 {node.pod_allocatable}</p> : null}
    </div>
  )
}

function NodePodsPanel({ node, pods, sortMode, onSortModeChange }: { node: K8sNode; pods: K8sPod[]; sortMode: SortMode; onSortModeChange: (mode: SortMode) => void }) {
  const usage = nodeUsage(pods)
  const sortedPods = [...pods].sort((a, b) => sortMode === 'cpu'
    ? (b.cpu_usage_milli || 0) - (a.cpu_usage_milli || 0)
    : (b.memory_usage_bytes || 0) - (a.memory_usage_bytes || 0)
  )

  return (
    <section aria-label={`${node.name} Pod 资源`} className="soft-card border-primary/20 bg-primary/5 p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-sm font-black text-foreground">节点资源</h3>
          <p className="mt-1 text-xs font-bold text-muted-foreground">{node.name} · {node.internal_ip || '未知 IP'}{node.pod_cidr ? ` · Pod CIDR ${node.pod_cidr}` : ''}</p>
        </div>
        <div className="soft-toolbar inline-flex w-fit p-1">
          <SortButton active={sortMode === 'memory'} onClick={() => onSortModeChange('memory')}>内存优先</SortButton>
          <SortButton active={sortMode === 'cpu'} onClick={() => onSortModeChange('cpu')}>CPU 优先</SortButton>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <ResourceFact title="Usage" primary={`${formatCPU(usage.cpuUsageMilli)} CPU`} secondary={`${formatBytes(usage.memoryUsageBytes)} 内存`} />
        <ResourceFact title="Allocatable" primary={formatCore(node.cpu_allocatable_milli, '未知')} secondary={formatBytes(node.memory_allocatable_bytes, '未知')} />
        <ResourceFact title="Capacity" primary={formatCore(node.cpu_capacity_milli, '未知')} secondary={formatBytes(node.memory_capacity_bytes, '未知')} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/85 bg-card/90">
        <div className="flex items-center justify-between gap-3 border-b border-border/80 bg-surface/55 px-4 py-3">
          <h4 className="text-sm font-black text-foreground">Top Pods</h4>
          <span className="text-xs font-bold text-muted-foreground">{pods.filter((pod) => pod.metrics_available).length}/{pods.length} 已上报</span>
        </div>
        {sortedPods.length > 0 ? (
          <div className="divide-y divide-border">
            {sortedPods.slice(0, 8).map((pod) => (
              <div key={`${pod.namespace}/${pod.name}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_80px_96px_96px] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-black text-foreground" title={pod.name}>{pod.name}</p>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">{pod.namespace} · {pod.status}</p>
                </div>
                <span className="text-xs font-bold text-muted-foreground">{pod.ready}</span>
                <span className="font-black text-foreground">{pod.metrics_available ? formatCPU(pod.cpu_usage_milli) : '未上报'}</span>
                <span className="font-black text-foreground">{pod.metrics_available ? formatBytes(pod.memory_usage_bytes) : '未上报'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-5 text-sm font-bold text-muted-foreground">该节点暂无 Pod。</div>
        )}
      </div>
    </section>
  )
}

function CompactMeter({ label, value, percent }: { label: string; value: string; percent?: number }) {
  const width = percent === undefined ? 0 : Math.min(100, Math.max(0, percent))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-black">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-foreground">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function ResourceFact({ title, primary, secondary }: { title: string; primary: string; secondary: string }) {
  return (
    <div className="rounded-2xl border border-border/85 bg-card/90 p-3">
      <p className="text-xs font-black text-muted-foreground">{title}</p>
      <p className="mt-2 text-sm font-black text-foreground">{primary}</p>
      <p className="mt-1 text-xs font-bold text-muted-foreground">{secondary}</p>
    </div>
  )
}

function SortButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`soft-button px-3 py-1.5 text-xs font-black ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
      {children}
    </button>
  )
}

function nodeUsage(pods: K8sPod[]) {
  return pods.reduce((total, pod) => ({
    cpuUsageMilli: total.cpuUsageMilli + (pod.cpu_usage_milli || 0),
    memoryUsageBytes: total.memoryUsageBytes + (pod.memory_usage_bytes || 0),
  }), { cpuUsageMilli: 0, memoryUsageBytes: 0 })
}

function usagePercent(usage?: number, limit?: number) {
  if (!usage || !limit || limit <= 0) return undefined
  return (usage / limit) * 100
}

function formatCPU(value?: number, fallback = '0m') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value <= 0) return fallback
  return `${Math.round(value)}m`
}

function formatCore(value?: number, fallback = '0 Core') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value <= 0) return fallback
  if (value % 1000 === 0) return `${value / 1000} Core`
  return `${Math.round(value)}m`
}

function formatBytes(value?: number, fallback = '0 B') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value <= 0) return fallback
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const scaled = value / 1024 ** index
  const rounded = Math.round(scaled * 10) / 10
  const text = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)
  return `${text} ${units[index]}`
}

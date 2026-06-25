import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

import type { K8sDeployment, K8sStatefulSet, K8sDaemonSet, K8sPod, K8sResourceKind } from '../../types'
import { K8sResourceActions } from './K8sResourceActions'
import { K8sResourceTable } from './K8sResourceTable'
import { K8sStatusBadge } from './K8sStatusBadge'

type WorkloadMode = 'deployment' | 'statefulset' | 'daemonset'
type WorkloadSortMode = 'memory' | 'cpu'

type K8sWorkloadTableProps = {
  clusterId: string
  mode: WorkloadMode
  items: K8sDeployment[] | K8sStatefulSet[] | K8sDaemonSet[]
  pods?: K8sPod[]
  loading?: boolean
  onViewDiagnostics?: (kind: K8sResourceKind, namespace: string, name: string) => void
  onToast: (message: string, type: 'success' | 'error') => void
  onResourceChanged?: () => void
}

type WorkloadIdentity = {
  kind: WorkloadMode
  namespace: string
  name: string
}

type WorkloadBase = {
  namespace: string
  name: string
}

function WorkloadNameButton({ workload, expanded, onToggle }: { workload: WorkloadIdentity; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? '收起' : '展开'} ${workloadLabel(workload.kind)} ${workload.name} Pod 资源`}
      onClick={onToggle}
      className="soft-button flex max-w-[200px] items-center gap-2 text-left font-black text-foreground hover:text-primary focus:outline-none focus:ring-4 focus:ring-primary/15"
      title={workload.name}
    >
      <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${expanded ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-surface text-muted-foreground'}`}>
        {expanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
      </span>
      <span className="truncate">{workload.name}</span>
    </button>
  )
}

function NamespaceName({ namespace }: { namespace: string }) {
  return <span className="block max-w-[120px] truncate text-muted-foreground" title={namespace}>{namespace}</span>
}

function desiredReplicasFromReady(ready: string): number | undefined {
  const desired = Number.parseInt((ready || '').split('/')[1] || '', 10)
  return Number.isFinite(desired) && desired >= 0 ? desired : undefined
}

export function K8sWorkloadTable({ clusterId, mode, items, pods = [], loading, onViewDiagnostics, onToast, onResourceChanged }: K8sWorkloadTableProps) {
  const [expandedKey, setExpandedKey] = useState<string>()
  const [sortMode, setSortMode] = useState<WorkloadSortMode>('memory')
  const identityFor = (item: WorkloadBase): WorkloadIdentity => ({ kind: mode, namespace: item.namespace, name: item.name })
  const keyFor = (item: WorkloadBase) => workloadKey(identityFor(item))
  const renderExpanded = (item: WorkloadBase) => (
    <WorkloadPodsPanel
      workload={identityFor(item)}
      pods={pods.filter((pod) => pod.namespace === item.namespace && pod.workload_kind === mode && pod.workload_name === item.name)}
      sortMode={sortMode}
      onSortModeChange={setSortMode}
    />
  )
  const renderName = (item: WorkloadBase) => {
    const key = keyFor(item)
    return (
      <WorkloadNameButton
        workload={identityFor(item)}
        expanded={expandedKey === key}
        onToggle={() => setExpandedKey((current) => current === key ? undefined : key)}
      />
    )
  }

  if (mode === 'deployment') {
    const deployments = items as K8sDeployment[]
    return (
      <K8sResourceTable
        items={deployments}
        loading={loading}
        emptyText="暂无 Deployment"
        getKey={keyFor}
        expandedKey={expandedKey}
        renderExpanded={renderExpanded}
        columns={[
          { key: 'name', title: '名称', render: renderName },
          { key: 'namespace', title: '命名空间', render: (item) => <NamespaceName namespace={item.namespace} /> },
          { key: 'ready', title: 'Ready', render: (item) => item.ready },
          { key: 'up_to_date', title: 'Up-to-date', render: (item) => item.up_to_date },
          { key: 'available', title: 'Available', render: (item) => item.available },
          { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
          {
            key: 'actions',
            title: '操作',
            align: 'center',
            render: (item) => (
              <K8sResourceActions
                clusterId={clusterId}
                kind="deployment"
                namespace={item.namespace}
                name={item.name}
                replicas={desiredReplicasFromReady(item.ready)}
                onViewDiagnostics={onViewDiagnostics}
                onToast={onToast}
                onResourceChanged={onResourceChanged}
              />
            )
          },
        ]}
      />
    )
  }

  if (mode === 'statefulset') {
    const statefulsets = items as K8sStatefulSet[]
    return (
      <K8sResourceTable
        items={statefulsets}
        loading={loading}
        emptyText="暂无 StatefulSet"
        getKey={keyFor}
        expandedKey={expandedKey}
        renderExpanded={renderExpanded}
        columns={[
          { key: 'name', title: '名称', render: renderName },
          { key: 'namespace', title: '命名空间', render: (item) => <NamespaceName namespace={item.namespace} /> },
          { key: 'ready', title: 'Ready', render: (item) => item.ready },
          { key: 'service_name', title: 'Service', render: (item) => <span className="text-muted-foreground">{item.service_name}</span> },
          { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
          {
            key: 'actions',
            title: '操作',
            align: 'center',
            render: (item) => (
              <K8sResourceActions
                clusterId={clusterId}
                kind="statefulset"
                namespace={item.namespace}
                name={item.name}
                replicas={desiredReplicasFromReady(item.ready)}
                onViewDiagnostics={onViewDiagnostics}
                onToast={onToast}
                onResourceChanged={onResourceChanged}
              />
            )
          },
        ]}
      />
    )
  }

  const daemonsets = items as K8sDaemonSet[]
  return (
    <K8sResourceTable
      items={daemonsets}
      loading={loading}
      emptyText="暂无 DaemonSet"
      getKey={keyFor}
      expandedKey={expandedKey}
      renderExpanded={renderExpanded}
      columns={[
        { key: 'name', title: '名称', render: renderName },
        { key: 'namespace', title: '命名空间', render: (item) => <NamespaceName namespace={item.namespace} /> },
        { key: 'desired', title: 'Desired', render: (item) => item.desired },
        { key: 'current', title: 'Current', render: (item) => item.current },
        { key: 'ready', title: 'Ready', render: (item) => item.ready },
        { key: 'available', title: 'Available', render: (item) => item.available },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
        {
          key: 'actions',
          title: '操作',
          align: 'center',
          render: (item) => (
            <K8sResourceActions
              clusterId={clusterId}
              kind="daemonset"
              namespace={item.namespace}
              name={item.name}
              onViewDiagnostics={onViewDiagnostics}
              onToast={onToast}
              onResourceChanged={onResourceChanged}
            />
          )
        },
      ]}
    />
  )
}

function workloadKey(item: WorkloadIdentity) {
  return `${item.kind}/${item.namespace}/${item.name}`
}

function workloadLabel(kind: WorkloadMode) {
  if (kind === 'deployment') return 'Deployment'
  if (kind === 'statefulset') return 'StatefulSet'
  return 'DaemonSet'
}

function WorkloadPodsPanel({ workload, pods, sortMode, onSortModeChange }: { workload: WorkloadIdentity; pods: K8sPod[]; sortMode: WorkloadSortMode; onSortModeChange: (mode: WorkloadSortMode) => void }) {
  const sortedPods = [...pods].sort((a, b) => sortMode === 'cpu'
    ? (b.cpu_usage_milli || 0) - (a.cpu_usage_milli || 0)
    : (b.memory_usage_bytes || 0) - (a.memory_usage_bytes || 0)
  )
  const usage = workloadUsage(pods)
  const readyPods = pods.filter(isPodReady).length
  const issuePods = pods.filter(hasPodIssue).length
  const reportedPods = pods.filter((pod) => pod.metrics_available).length
  const hasReportedMetrics = reportedPods > 0
  const nodes = new Set(pods.map((pod) => pod.node).filter(Boolean))

  return (
    <section aria-label={`${workload.name} Pod 资源`} className="soft-card border-primary/20 bg-primary/5 p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-black text-foreground">Workload Pods</h3>
          <p className="mt-1 truncate text-xs font-bold text-muted-foreground">{workloadLabel(workload.kind)} · {workload.namespace} / {workload.name}</p>
        </div>
        <div className="soft-toolbar inline-flex w-fit p-1">
          <SortButton active={sortMode === 'memory'} onClick={() => onSortModeChange('memory')}>内存优先</SortButton>
          <SortButton active={sortMode === 'cpu'} onClick={() => onSortModeChange('cpu')}>CPU 优先</SortButton>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <WorkloadFact title="Pods" primary={`${readyPods}/${pods.length} Ready`} secondary={`${reportedPods}/${pods.length} 已上报`} />
        <WorkloadFact title="CPU" primary={hasReportedMetrics ? formatCPU(usage.cpuUsageMilli) : '未上报'} secondary={`${reportedPods}/${pods.length} Pods`} />
        <WorkloadFact title="内存" primary={hasReportedMetrics ? formatBytes(usage.memoryUsageBytes) : '未上报'} secondary={`${reportedPods}/${pods.length} Pods`} />
        <WorkloadFact title="节点分布" primary={`${nodes.size || 0} 节点`} secondary={nodes.size ? Array.from(nodes).slice(0, 2).join(' / ') : '暂无节点'} />
        <WorkloadFact title="重启" primary={`${usage.restarts} 次`} secondary="Pod 累计" />
        <WorkloadFact title="异常" primary={`${issuePods} Pods`} secondary={issuePods > 0 ? '需要关注' : '状态正常'} tone={issuePods > 0 ? 'warning' : 'default'} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/85 bg-card/90">
        <div className="flex items-center justify-between gap-3 border-b border-border/80 bg-surface/55 px-4 py-3">
          <h4 className="text-sm font-black text-foreground">Pod 明细</h4>
          <span className="text-xs font-bold text-muted-foreground">{pods.length} Pods</span>
        </div>
        {sortedPods.length > 0 ? (
          <div className="divide-y divide-border">
            {sortedPods.map((pod) => (
              <div key={`${pod.namespace}/${pod.name}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.3fr)_120px_96px_92px_96px] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-black text-foreground" title={pod.name}>{pod.name}</p>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">{pod.namespace} · {pod.ready} · 重启 {pod.restarts}</p>
                </div>
                <K8sStatusBadge status={pod.status} />
                <span className="truncate text-xs font-bold text-muted-foreground" title={pod.node || undefined}>{pod.node || '未调度'}</span>
                <span className="font-black text-foreground">{pod.metrics_available ? formatCPU(pod.cpu_usage_milli) : '未上报'}</span>
                <span className="font-black text-foreground">{pod.metrics_available ? formatBytes(pod.memory_usage_bytes) : '未上报'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-5 text-sm font-bold text-muted-foreground">未匹配到该 Workload 的 Pod。刚扩缩容、重启或 Agent 尚未上报 owner 信息时，可能需要稍后刷新。</div>
        )}
      </div>
    </section>
  )
}

function WorkloadFact({ title, primary, secondary, tone = 'default' }: { title: string; primary: string; secondary: string; tone?: 'default' | 'warning' }) {
  return (
    <div className={`rounded-2xl border bg-card/90 p-3 ${tone === 'warning' ? 'border-warning/30' : 'border-border/85'}`}>
      <p className="text-xs font-black text-muted-foreground">{title}</p>
      <p className={`mt-2 text-sm font-black ${tone === 'warning' ? 'text-warning' : 'text-foreground'}`}>{primary}</p>
      <p className="mt-1 truncate text-xs font-bold text-muted-foreground" title={secondary}>{secondary}</p>
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

function workloadUsage(pods: K8sPod[]) {
  return pods.reduce((total, pod) => ({
    cpuUsageMilli: total.cpuUsageMilli + (pod.cpu_usage_milli || 0),
    memoryUsageBytes: total.memoryUsageBytes + (pod.memory_usage_bytes || 0),
    restarts: total.restarts + (pod.restarts || 0),
  }), { cpuUsageMilli: 0, memoryUsageBytes: 0, restarts: 0 })
}

function isPodReady(pod: K8sPod) {
  const [ready, total] = pod.ready.split('/').map((value) => Number.parseInt(value, 10))
  return Number.isFinite(ready) && Number.isFinite(total) && total > 0 && ready === total
}

function hasPodIssue(pod: K8sPod) {
  return !isPodReady(pod) || !['Running', 'Succeeded'].includes(pod.status) || pod.restarts > 0
}

function formatCPU(value?: number, fallback = '0m') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value <= 0) return fallback
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

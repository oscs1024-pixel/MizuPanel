import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchK8sCluster,
  fetchK8sSummary,
  fetchK8sNamespaces,
  fetchK8sNodes,
  fetchK8sPods,
  fetchK8sDeployments,
  fetchK8sStatefulSets,
  fetchK8sDaemonSets,
  fetchK8sServices,
  fetchK8sIngresses,
} from '../api/k8s'
import type {
  K8sCluster,
  K8sResourceSummary,
  K8sNamespace,
  K8sNode,
  K8sPod,
  K8sDeployment,
  K8sStatefulSet,
  K8sDaemonSet,
  K8sService,
  K8sIngress,
} from '../types'
import { Toast } from '../components/Toast'
import K8sPodLogsModal from '../components/K8sPodLogsModal'
import { K8sNamespaceTable } from '../components/k8s/K8sNamespaceTable'
import { K8sNodeTable } from '../components/k8s/K8sNodeTable'
import { K8sPodTable } from '../components/k8s/K8sPodTable'
import { K8sWorkloadTable } from '../components/k8s/K8sWorkloadTable'
import { K8sServiceTable } from '../components/k8s/K8sServiceTable'
import { K8sIngressTable } from '../components/k8s/K8sIngressTable'

type K8sClusterDetailPageProps = {
  clusterId: string
  onBack: () => void
}

type DetailTab = 'overview' | 'namespaces' | 'nodes' | 'pods' | 'deployments' | 'statefulsets' | 'daemonsets' | 'services' | 'ingresses'

const DETAIL_TABS: Array<{ key: DetailTab; label: string; shortLabel?: string }> = [
  { key: 'overview', label: '集群概览', shortLabel: 'Summary' },
  { key: 'namespaces', label: '命名空间', shortLabel: 'NS' },
  { key: 'nodes', label: '节点', shortLabel: 'Nodes' },
  { key: 'pods', label: 'Pods' },
  { key: 'deployments', label: 'Deployments' },
  { key: 'statefulsets', label: 'StatefulSets' },
  { key: 'daemonsets', label: 'DaemonSets' },
  { key: 'services', label: 'Services' },
  { key: 'ingresses', label: 'Ingresses' },
]

function tabLabel(tab: DetailTab): string {
  return DETAIL_TABS.find((item) => item.key === tab)?.label || tab
}

export function K8sClusterDetailPage({ clusterId, onBack }: K8sClusterDetailPageProps) {
  const [cluster, setCluster] = useState<K8sCluster>()
  const [summary, setSummary] = useState<K8sResourceSummary>()
  const [namespaces, setNamespaces] = useState<K8sNamespace[]>([])
  const [nodes, setNodes] = useState<K8sNode[]>([])
  const [pods, setPods] = useState<K8sPod[]>([])
  const [deployments, setDeployments] = useState<K8sDeployment[]>([])
  const [statefulsets, setStatefulSets] = useState<K8sStatefulSet[]>([])
  const [daemonsets, setDaemonSets] = useState<K8sDaemonSet[]>([])
  const [services, setServices] = useState<K8sService[]>([])
  const [ingresses, setIngresses] = useState<K8sIngress[]>([])
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [namespace, setNamespace] = useState<string>('')
  const [podSearch, setPodSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [resourcesLoading, setResourcesLoading] = useState(false)
  const [resourceError, setResourceError] = useState<string>()
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [logsModal, setLogsModal] = useState<{ open: boolean; namespace: string; podName: string }>({
    open: false,
    namespace: '',
    podName: '',
  })
  const clusterRequestSeq = useRef(0)
  const resourceRequestSeq = useRef(0)
  const namespaceRef = useRef('')

  useEffect(() => {
    namespaceRef.current = namespace
  }, [namespace])

  const loadCluster = useCallback(() => {
    const requestID = clusterRequestSeq.current + 1
    clusterRequestSeq.current = requestID
    resourceRequestSeq.current += 1
    const isCurrentRequest = () => clusterRequestSeq.current === requestID

    setLoading(true)
    setError(undefined)
    setResourceError(undefined)
    setSummary(undefined)
    setNamespaces([])
    setNodes([])
    setPods([])
    setDeployments([])
    setStatefulSets([])
    setDaemonSets([])
    setServices([])
    setIngresses([])

    fetchK8sCluster(clusterId)
      .then((response) => {
        if (isCurrentRequest()) setCluster(response.cluster)
      })
      .catch((err: Error) => {
        if (!isCurrentRequest()) return
        setError(err.message)
        setToast({ message: `集群加载失败: ${err.message}`, type: 'error' })
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false)
      })
  }, [clusterId])

  const loadActiveResource = useCallback((requestedNamespace?: string) => {
    const effectiveNamespace = requestedNamespace ?? namespaceRef.current
    const agentOnline = cluster?.node_status ? cluster.node_status === 'online' : true
    if (!cluster || cluster.status !== 'online' || !agentOnline) return

    const requestID = resourceRequestSeq.current + 1
    resourceRequestSeq.current = requestID
    const isCurrentRequest = () => resourceRequestSeq.current === requestID

    setResourcesLoading(true)
    setResourceError(undefined)

    const fail = (label: string, err: Error) => {
      if (!isCurrentRequest()) return
      setResourceError(`${label}加载失败: ${err.message}`)
      setToast({ message: `${label}加载失败: ${err.message}`, type: 'error' })
    }

    let request: Promise<unknown>
    switch (activeTab) {
      case 'overview':
        request = fetchK8sSummary(clusterId).then((response) => {
          if (isCurrentRequest()) setSummary(response.summary)
        })
        break
      case 'namespaces':
        request = fetchK8sNamespaces(clusterId).then((response) => {
          if (isCurrentRequest()) setNamespaces(response.namespaces || [])
        })
        break
      case 'nodes':
        request = fetchK8sNodes(clusterId).then((response) => {
          if (isCurrentRequest()) setNodes(response.nodes || [])
        })
        break
      case 'pods':
        request = fetchK8sPods(clusterId, effectiveNamespace || undefined).then((response) => {
          if (isCurrentRequest()) setPods(response.pods || [])
        })
        break
      case 'deployments':
        request = fetchK8sDeployments(clusterId, effectiveNamespace || undefined).then((response) => {
          if (isCurrentRequest()) setDeployments(response.deployments || [])
        })
        break
      case 'statefulsets':
        request = fetchK8sStatefulSets(clusterId, effectiveNamespace || undefined).then((response) => {
          if (isCurrentRequest()) setStatefulSets(response.statefulsets || [])
        })
        break
      case 'daemonsets':
        request = fetchK8sDaemonSets(clusterId, effectiveNamespace || undefined).then((response) => {
          if (isCurrentRequest()) setDaemonSets(response.daemonsets || [])
        })
        break
      case 'services':
        request = fetchK8sServices(clusterId, effectiveNamespace || undefined).then((response) => {
          if (isCurrentRequest()) setServices(response.services || [])
        })
        break
      case 'ingresses':
        request = fetchK8sIngresses(clusterId, effectiveNamespace || undefined).then((response) => {
          if (isCurrentRequest()) setIngresses(response.ingresses || [])
        })
        break
    }

    request
      .catch((err: Error) => fail(tabLabel(activeTab), err))
      .finally(() => {
        if (isCurrentRequest()) setResourcesLoading(false)
      })
  }, [activeTab, cluster, clusterId])

  useEffect(() => {
    loadCluster()
  }, [loadCluster])

  useEffect(() => {
    const agentOnline = cluster?.node_status ? cluster.node_status === 'online' : true
    if (cluster?.status === 'online' && agentOnline) {
      loadActiveResource()
    }
  }, [cluster?.status, cluster?.node_status, loadActiveResource])

  const safePods = Array.isArray(pods) ? pods : []
  const filteredPods = safePods.filter((pod) => {
    if (!podSearch) return true
    const search = podSearch.toLowerCase()
    return (
      (pod.name || '').toLowerCase().includes(search) ||
      (pod.namespace || '').toLowerCase().includes(search) ||
      (pod.status || '').toLowerCase().includes(search)
    )
  })

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-3 inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
          <p className="text-sm font-semibold text-muted-foreground">加载集群信息...</p>
        </div>
      </div>
    )
  }

  if (error || !cluster) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-semibold text-destructive">{error || '集群不存在'}</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
          >
            返回列表
          </button>
        </div>
      </div>
    )
  }

  const agentOnline = cluster.node_status ? cluster.node_status === 'online' : true
  const isOnline = cluster.status === 'online' && agentOnline
  const resourceCounts: Partial<Record<DetailTab, number | undefined>> = {
    overview: undefined,
    namespaces: summary?.namespace_count ?? namespaces.length,
    nodes: summary?.node_count ?? nodes.length,
    pods: summary?.pod_count ?? pods.length,
    deployments: summary?.deployment_count ?? deployments.length,
    statefulsets: summary?.statefulset_count ?? statefulsets.length,
    daemonsets: summary?.daemonset_count ?? daemonsets.length,
    services: summary?.service_count ?? services.length,
    ingresses: summary?.ingress_count ?? ingresses.length,
  }

  return (
    <div className="h-full overflow-auto p-6">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <K8sPodLogsModal
        clusterId={clusterId}
        namespace={logsModal.namespace}
        podName={logsModal.podName}
        open={logsModal.open}
        onClose={() => setLogsModal({ open: false, namespace: '', podName: '' })}
      />

      <div className="mx-auto max-w-[1380px] space-y-5">
        <header className="rounded-[20px] border border-border bg-card p-5 shadow-sm">
          <button
            type="button"
            onClick={onBack}
            className="mb-4 flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            返回 Kubernetes 集群
          </button>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`h-3 w-3 shrink-0 rounded-full ${isOnline ? 'bg-success shadow-[0_0_14px_rgb(var(--success)/0.35)]' : 'bg-muted-foreground/40'}`} />
                <h1 className="min-w-0 truncate text-2xl font-black text-foreground">{cluster.name}</h1>
                <span className={`rounded-full border px-3 py-1 text-xs font-black ${isOnline ? 'border-success/20 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground'}`}>
                  {isOnline ? '在线' : '离线'}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold text-muted-foreground">
                Agent: {cluster.node_name || '未知 Agent'} · {cluster.node_ip || '未知 IP'}
                {cluster.context ? ` · Context: ${cluster.context}` : ''}
                {cluster.last_seen_at ? ` · Last Seen: ${new Date(cluster.last_seen_at).toLocaleString('zh-CN')}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadActiveResource()}
              disabled={resourcesLoading || !isOnline}
              className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-2 text-sm font-black text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新资源'}
            </button>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <K8sSummaryCard label="K8s 版本" value={summary?.version || cluster.version || '-'} accent />
          <K8sSummaryCard label="节点" value={String(summary?.node_count ?? cluster.node_count ?? '-')} />
          <K8sSummaryCard label="命名空间" value={String(summary?.namespace_count ?? cluster.namespace_count ?? '-')} />
          <K8sSummaryCard label="Pods" value={String(summary?.pod_count ?? pods.length)} />
          <K8sSummaryCard label="Deployments" value={String(summary?.deployment_count ?? deployments.length)} />
          <K8sSummaryCard label="Services" value={String(summary?.service_count ?? services.length)} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <K8sDetailSidebar activeTab={activeTab} counts={resourceCounts} onSelect={setActiveTab} />
          <main className="min-w-0 space-y-4">
            {activeTab !== 'overview' && resourceError && isOnline && (
              <ResourceError message={resourceError} onRetry={loadActiveResource} compact />
            )}

            {activeTab === 'overview' && (
              <div className="space-y-4">
                {!isOnline ? (
                  <K8sOfflineState message="集群或 Agent 节点离线，无法查看集群资源信息" />
                ) : resourcesLoading ? (
                  <div className="rounded-[16px] border border-border bg-card p-8 text-center shadow-sm">
                    <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
                    <p className="text-sm font-bold text-muted-foreground">加载集群信息...</p>
                  </div>
                ) : resourceError ? (
                  <ResourceError message={resourceError} onRetry={loadActiveResource} />
                ) : (
                  <>
                    <K8sDetailPanel title="资源统计">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        <K8sSummaryCard label="Pods" value={String(summary?.pod_count ?? pods.length)} />
                        <K8sSummaryCard label="Deployments" value={String(summary?.deployment_count ?? deployments.length)} />
                        <K8sSummaryCard label="StatefulSets" value={String(summary?.statefulset_count ?? statefulsets.length)} />
                        <K8sSummaryCard label="DaemonSets" value={String(summary?.daemonset_count ?? daemonsets.length)} />
                        <K8sSummaryCard label="Services" value={String(summary?.service_count ?? services.length)} />
                        <K8sSummaryCard label="Ingresses" value={String(summary?.ingress_count ?? ingresses.length)} />
                      </div>
                    </K8sDetailPanel>

                    <K8sDetailPanel title="连接信息">
                      <div className="divide-y divide-border rounded-xl border border-border bg-surface px-4">
                        {cluster.kubeconfig_path && <InfoRow label="kubeconfig 路径" value={cluster.kubeconfig_path} />}
                        {cluster.context && <InfoRow label="Context" value={cluster.context} />}
                        <InfoRow label="Agent 节点" value={`${cluster.node_name || '未知 Agent'} (${cluster.node_ip || '未知 IP'})`} />
                        <InfoRow label="创建时间" value={new Date(cluster.created_at).toLocaleString('zh-CN')} />
                        {cluster.last_seen_at && <InfoRow label="最后连接时间" value={new Date(cluster.last_seen_at).toLocaleString('zh-CN')} />}
                      </div>
                    </K8sDetailPanel>
                  </>
                )}
              </div>
            )}

            {activeTab === 'namespaces' && (
              <K8sDetailPanel
                title="命名空间"
                actions={(
                  <button type="button" onClick={() => loadActiveResource()} disabled={resourcesLoading || !isOnline} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-black text-foreground transition hover:bg-muted disabled:opacity-50">
                    {resourcesLoading ? '加载中...' : '刷新'}
                  </button>
                )}
              >
                {!isOnline ? <K8sOfflineState message="集群或 Agent 节点离线，无法查看 Namespace 列表" /> : <K8sNamespaceTable items={namespaces} loading={resourcesLoading} />}
              </K8sDetailPanel>
            )}

            {activeTab === 'nodes' && (
              <K8sDetailPanel
                title="节点"
                actions={(
                  <button type="button" onClick={() => loadActiveResource()} disabled={resourcesLoading || !isOnline} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-black text-foreground transition hover:bg-muted disabled:opacity-50">
                    {resourcesLoading ? '加载中...' : '刷新'}
                  </button>
                )}
              >
                {!isOnline ? <K8sOfflineState message="集群或 Agent 节点离线，无法查看 Node 列表" /> : <K8sNodeTable items={nodes} loading={resourcesLoading} />}
              </K8sDetailPanel>
            )}

            {activeTab === 'pods' && (
              <K8sDetailPanel title="Pods">
                <K8sFilterBar>
                  <input
                    type="text"
                    value={namespace}
                    onChange={(e) => setNamespace(e.target.value)}
                    placeholder="命名空间 (留空查看全部)"
                    className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <input
                    type="text"
                    value={podSearch}
                    onChange={(e) => setPodSearch(e.target.value)}
                    placeholder="搜索 Pod / 命名空间 / 状态"
                    className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button type="button" onClick={() => loadActiveResource()} disabled={resourcesLoading || !isOnline} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
                    {resourcesLoading ? '加载中...' : '刷新'}
                  </button>
                </K8sFilterBar>

                {!isOnline ? (
                  <K8sOfflineState message="集群或 Agent 节点离线，无法查看 Pod 列表" />
                ) : filteredPods.length === 0 && !resourcesLoading ? (
                  <K8sOfflineState message={pods.length === 0 ? '暂无 Pod' : '没有匹配的 Pod'} />
                ) : (
                  <K8sPodTable items={filteredPods} loading={resourcesLoading} onViewLogs={(ns, name) => setLogsModal({ open: true, namespace: ns, podName: name })} />
                )}
              </K8sDetailPanel>
            )}

            {activeTab === 'deployments' && (
              <K8sDetailPanel title="Deployments">
                <NamespaceFilter namespace={namespace} setNamespace={setNamespace} loading={resourcesLoading} isOnline={isOnline} onRefresh={loadActiveResource} />
                {!isOnline ? <K8sOfflineState message="集群或 Agent 节点离线，无法查看 Deployment 列表" /> : <K8sWorkloadTable mode="deployment" items={deployments} loading={resourcesLoading} />}
              </K8sDetailPanel>
            )}

            {activeTab === 'statefulsets' && (
              <K8sDetailPanel title="StatefulSets">
                <NamespaceFilter namespace={namespace} setNamespace={setNamespace} loading={resourcesLoading} isOnline={isOnline} onRefresh={loadActiveResource} />
                {!isOnline ? <K8sOfflineState message="集群或 Agent 节点离线，无法查看 StatefulSet 列表" /> : <K8sWorkloadTable mode="statefulset" items={statefulsets} loading={resourcesLoading} />}
              </K8sDetailPanel>
            )}

            {activeTab === 'daemonsets' && (
              <K8sDetailPanel title="DaemonSets">
                <NamespaceFilter namespace={namespace} setNamespace={setNamespace} loading={resourcesLoading} isOnline={isOnline} onRefresh={loadActiveResource} />
                {!isOnline ? <K8sOfflineState message="集群或 Agent 节点离线，无法查看 DaemonSet 列表" /> : <K8sWorkloadTable mode="daemonset" items={daemonsets} loading={resourcesLoading} />}
              </K8sDetailPanel>
            )}

            {activeTab === 'services' && (
              <K8sDetailPanel title="Services">
                <NamespaceFilter namespace={namespace} setNamespace={setNamespace} loading={resourcesLoading} isOnline={isOnline} onRefresh={loadActiveResource} />
                {!isOnline ? <K8sOfflineState message="集群或 Agent 节点离线，无法查看 Service 列表" /> : <K8sServiceTable items={services} loading={resourcesLoading} />}
              </K8sDetailPanel>
            )}

            {activeTab === 'ingresses' && (
              <K8sDetailPanel title="Ingresses">
                <NamespaceFilter namespace={namespace} setNamespace={setNamespace} loading={resourcesLoading} isOnline={isOnline} onRefresh={loadActiveResource} />
                {!isOnline ? <K8sOfflineState message="集群或 Agent 节点离线，无法查看 Ingress 列表" /> : <K8sIngressTable items={ingresses} loading={resourcesLoading} />}
              </K8sDetailPanel>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function ResourceError({ message, onRetry, compact = false }: { message: string; onRetry: () => void; compact?: boolean }) {
  return (
    <div className={`rounded-[16px] border border-danger/30 bg-danger/5 text-center ${compact ? 'p-4' : 'p-8'}`}>
      <p className="text-sm font-bold text-danger">{message}</p>
      <button
        type="button"
        onClick={() => onRetry()}
        className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
      >
        重试
      </button>
    </div>
  )
}

function K8sSummaryCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[16px] border border-border bg-card p-4 shadow-sm">
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-primary/40 to-accent/20" />
      <p className="text-xs font-black text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-black tracking-tight ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}

function K8sOfflineState({ message }: { message: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-border bg-card p-8 text-center shadow-sm">
      <p className="text-sm font-bold text-muted-foreground">{message}</p>
    </div>
  )
}

function K8sDetailPanel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[16px] border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <h2 className="text-base font-black text-foreground">{title}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function K8sFilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap gap-3">{children}</div>
}

function NamespaceFilter({ namespace, setNamespace, loading, isOnline, onRefresh }: { namespace: string; setNamespace: (namespace: string) => void; loading: boolean; isOnline: boolean; onRefresh: () => void }) {
  return (
    <K8sFilterBar>
      <input
        type="text"
        value={namespace}
        onChange={(e) => setNamespace(e.target.value)}
        placeholder="命名空间 (留空查看全部)"
        className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      <button type="button" onClick={() => onRefresh()} disabled={loading || !isOnline} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
        {loading ? '加载中...' : '刷新'}
      </button>
    </K8sFilterBar>
  )
}

function K8sDetailSidebar({ activeTab, counts, onSelect }: { activeTab: DetailTab; counts: Partial<Record<DetailTab, number | undefined>>; onSelect: (tab: DetailTab) => void }) {
  return (
    <aside className="rounded-[18px] border border-border bg-card p-2 shadow-sm lg:sticky lg:top-6">
      <nav className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
        {DETAIL_TABS.map((item) => {
          const active = activeTab === item.key
          const count = counts[item.key]
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-black transition ${active ? 'border border-primary/20 bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 text-xs opacity-75">{count === undefined ? item.shortLabel || '' : count}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-3">
      <span className="text-sm font-bold text-muted-foreground">{label}</span>
      <span className="break-all text-right text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

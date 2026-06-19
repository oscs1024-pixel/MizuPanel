import { useCallback, useEffect, useState } from 'react'
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

function tabLabel(tab: DetailTab): string {
  const labels: Record<DetailTab, string> = {
    overview: '集群概览',
    namespaces: 'Namespace 列表',
    nodes: 'Node 列表',
    pods: 'Pod 列表',
    deployments: 'Deployment 列表',
    statefulsets: 'StatefulSet 列表',
    daemonsets: 'DaemonSet 列表',
    services: 'Service 列表',
    ingresses: 'Ingress 列表',
  }
  return labels[tab]
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

  const loadCluster = useCallback(() => {
    setLoading(true)
    setError(undefined)
    fetchK8sCluster(clusterId)
      .then((response) => {
        setCluster(response.cluster)
      })
      .catch((err: Error) => {
        setError(err.message)
        setToast({ message: `集群加载失败: ${err.message}`, type: 'error' })
      })
      .finally(() => {
        setLoading(false)
      })
  }, [clusterId])

  const loadActiveResource = useCallback(() => {
    if (!cluster || cluster.status !== 'online') return
    setResourcesLoading(true)
    setResourceError(undefined)

    const fail = (label: string, err: Error) => {
      setResourceError(`${label}加载失败: ${err.message}`)
      setToast({ message: `${label}加载失败: ${err.message}`, type: 'error' })
    }

    let request: Promise<unknown>
    switch (activeTab) {
      case 'overview':
        request = fetchK8sSummary(clusterId).then((response) => setSummary(response.summary))
        break
      case 'namespaces':
        request = fetchK8sNamespaces(clusterId).then((response) => setNamespaces(response.namespaces))
        break
      case 'nodes':
        request = fetchK8sNodes(clusterId).then((response) => setNodes(response.nodes))
        break
      case 'pods':
        request = fetchK8sPods(clusterId, namespace || undefined).then((response) => setPods(response.pods))
        break
      case 'deployments':
        request = fetchK8sDeployments(clusterId, namespace || undefined).then((response) => setDeployments(response.deployments))
        break
      case 'statefulsets':
        request = fetchK8sStatefulSets(clusterId, namespace || undefined).then((response) => setStatefulSets(response.statefulsets))
        break
      case 'daemonsets':
        request = fetchK8sDaemonSets(clusterId, namespace || undefined).then((response) => setDaemonSets(response.daemonsets))
        break
      case 'services':
        request = fetchK8sServices(clusterId, namespace || undefined).then((response) => setServices(response.services))
        break
      case 'ingresses':
        request = fetchK8sIngresses(clusterId, namespace || undefined).then((response) => setIngresses(response.ingresses))
        break
    }

    request.catch((err: Error) => fail(tabLabel(activeTab), err)).finally(() => setResourcesLoading(false))
  }, [activeTab, cluster, clusterId, namespace])

  useEffect(() => {
    loadCluster()
  }, [loadCluster])

  useEffect(() => {
    if (cluster?.status === 'online') {
      loadActiveResource()
    }
  }, [activeTab, cluster?.status, loadActiveResource])

  const filteredPods = pods.filter((pod) => {
    if (!podSearch) return true
    const search = podSearch.toLowerCase()
    return (
      pod.name.toLowerCase().includes(search) ||
      pod.namespace.toLowerCase().includes(search) ||
      pod.status.toLowerCase().includes(search)
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

  const isOnline = cluster.status === 'online'

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

      {/* Header */}
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-2 text-sm font-bold text-muted-foreground transition hover:text-foreground"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          返回集群列表
        </button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 shrink-0 rounded-full ${isOnline ? 'bg-success shadow-[0_0_14px_rgb(var(--success)/0.45)]' : 'bg-muted-foreground/40'}`} />
              <h1 className="text-2xl font-black text-foreground">{cluster.name}</h1>
              <span className={`rounded-full px-3 py-1 text-xs font-black ${isOnline ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                {isOnline ? '在线' : '离线'}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Agent 节点: {cluster.node_name} ({cluster.node_ip})
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-border overflow-x-auto">
        {(['overview', 'namespaces', 'nodes', 'pods', 'deployments', 'statefulsets', 'daemonsets', 'services', 'ingresses'] as DetailTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-bold transition whitespace-nowrap ${
              activeTab === tab
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tabLabel(tab).replace(' 列表', '')}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab !== 'overview' && resourceError && isOnline && (
        <div className="mb-4">
          <ResourceError message={resourceError} onRetry={loadActiveResource} compact />
        </div>
      )}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Cluster Info */}
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看集群信息</p>
            </div>
          ) : resourcesLoading ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
              <p className="text-sm font-semibold text-muted-foreground">加载集群信息...</p>
            </div>
          ) : resourceError ? (
            <ResourceError message={resourceError} onRetry={loadActiveResource} />
          ) : summary ? (
            <>
              <div className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
                <h3 className="mb-4 text-base font-black text-foreground">集群信息</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <InfoCard label="Kubernetes 版本" value={summary.version} />
                  <InfoCard label="节点数量" value={summary.node_count.toString()} />
                  <InfoCard label="命名空间数量" value={summary.namespace_count.toString()} />
                </div>
              </div>
              <div className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
                <h3 className="mb-4 text-base font-black text-foreground">资源统计</h3>
                <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-6">
                  <InfoCard label="Pods" value={summary.pod_count.toString()} />
                  <InfoCard label="Deployments" value={summary.deployment_count.toString()} />
                  <InfoCard label="StatefulSets" value={summary.statefulset_count.toString()} />
                  <InfoCard label="DaemonSets" value={summary.daemonset_count.toString()} />
                  <InfoCard label="Services" value={summary.service_count.toString()} />
                  <InfoCard label="Ingresses" value={summary.ingress_count.toString()} />
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">暂无集群信息</p>
            </div>
          )}

          {/* Connection Info */}
          <div className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-4 text-base font-black text-foreground">连接信息</h3>
            <div className="space-y-3">
              {cluster.kubeconfig_path && <InfoRow label="kubeconfig 路径" value={cluster.kubeconfig_path} />}
              {cluster.context && <InfoRow label="Context" value={cluster.context} />}
              <InfoRow label="创建时间" value={new Date(cluster.created_at).toLocaleString('zh-CN')} />
              {cluster.last_seen_at && (
                <InfoRow label="最后连接时间" value={new Date(cluster.last_seen_at).toLocaleString('zh-CN')} />
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'namespaces' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={loadActiveResource}
              disabled={resourcesLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新'}
            </button>
          </div>
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 Namespace 列表</p>
            </div>
          ) : (
            <K8sNamespaceTable items={namespaces} loading={resourcesLoading} />
          )}
        </div>
      )}

      {activeTab === 'nodes' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={loadActiveResource}
              disabled={resourcesLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新'}
            </button>
          </div>
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 Node 列表</p>
            </div>
          ) : (
            <K8sNodeTable items={nodes} loading={resourcesLoading} />
          )}
        </div>
      )}

      {activeTab === 'pods' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3">
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="命名空间 (留空查看全部)"
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <input
              type="text"
              value={podSearch}
              onChange={(e) => setPodSearch(e.target.value)}
              placeholder="搜索 Pod..."
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={loadActiveResource}
              disabled={resourcesLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新'}
            </button>
          </div>

          {/* Pods List */}
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 Pod 列表</p>
            </div>
          ) : filteredPods.length === 0 && !resourcesLoading ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">
                {pods.length === 0 ? '暂无 Pod' : '没有匹配的 Pod'}
              </p>
            </div>
          ) : (
            <K8sPodTable
              items={filteredPods}
              loading={resourcesLoading}
              onViewLogs={(ns, name) => setLogsModal({ open: true, namespace: ns, podName: name })}
            />
          )}
        </div>
      )}

      {activeTab === 'deployments' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="命名空间 (留空查看全部)"
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={loadActiveResource}
              disabled={resourcesLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新'}
            </button>
          </div>
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 Deployment 列表</p>
            </div>
          ) : (
            <K8sWorkloadTable mode="deployment" items={deployments} loading={resourcesLoading} />
          )}
        </div>
      )}

      {activeTab === 'statefulsets' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="命名空间 (留空查看全部)"
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={loadActiveResource}
              disabled={resourcesLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新'}
            </button>
          </div>
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 StatefulSet 列表</p>
            </div>
          ) : (
            <K8sWorkloadTable mode="statefulset" items={statefulsets} loading={resourcesLoading} />
          )}
        </div>
      )}

      {activeTab === 'daemonsets' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="命名空间 (留空查看全部)"
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={loadActiveResource}
              disabled={resourcesLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新'}
            </button>
          </div>
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 DaemonSet 列表</p>
            </div>
          ) : (
            <K8sWorkloadTable mode="daemonset" items={daemonsets} loading={resourcesLoading} />
          )}
        </div>
      )}

      {activeTab === 'services' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="命名空间 (留空查看全部)"
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={loadActiveResource}
              disabled={resourcesLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新'}
            </button>
          </div>
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 Service 列表</p>
            </div>
          ) : (
            <K8sServiceTable items={services} loading={resourcesLoading} />
          )}
        </div>
      )}

      {activeTab === 'ingresses' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="命名空间 (留空查看全部)"
              className="flex-1 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={loadActiveResource}
              disabled={resourcesLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {resourcesLoading ? '加载中...' : '刷新'}
            </button>
          </div>
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 Ingress 列表</p>
            </div>
          ) : (
            <K8sIngressTable items={ingresses} loading={resourcesLoading} />
          )}
        </div>
      )}
    </div>
  )
}

function ResourceError({ message, onRetry, compact = false }: { message: string; onRetry: () => void; compact?: boolean }) {
  return (
    <div className={`rounded-[14px] border border-destructive/30 bg-destructive/5 text-center ${compact ? 'p-4' : 'p-8'}`}>
      <p className="text-sm font-bold text-destructive">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
      >
        重试
      </button>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-black text-foreground">{value}</p>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <span className="text-sm font-bold text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

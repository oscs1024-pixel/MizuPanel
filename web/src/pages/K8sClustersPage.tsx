import { useCallback, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { fetchK8sClusters, deleteK8sCluster } from '../api/k8s'
import type { K8sCluster } from '../types'
import { Toast } from '../components/Toast'

type K8sClustersPageProps = {
  onConnectCluster: () => void
  onViewDetail?: (clusterID: string) => void
}

export function K8sClustersPage({ onConnectCluster, onViewDetail }: K8sClustersPageProps) {
  const [clusters, setClusters] = useState<K8sCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [pendingDeleteID, setPendingDeleteID] = useState<string | null>(null)
  const [clusterSearch, setClusterSearch] = useState('')

  const loadClusters = useCallback(() => {
    setLoading(true)
    setError(undefined)
    fetchK8sClusters()
      .then((response) => {
        setClusters(response.clusters || [])
      })
      .catch((err: Error) => {
        setError(err.message)
        setToast({ message: `集群列表加载失败: ${err.message}`, type: 'error' })
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadClusters()
  }, [loadClusters])

  const handleDeleteCluster = useCallback((clusterID: string) => {
    deleteK8sCluster(clusterID)
      .then(() => {
        setToast({ message: '集群删除成功', type: 'success' })
        setPendingDeleteID(null)
        loadClusters()
      })
      .catch((err: Error) => {
        setToast({ message: `集群删除失败: ${err.message}`, type: 'error' })
      })
  }, [loadClusters])

  const normalizedSearch = clusterSearch.trim().toLowerCase()
  const filteredClusters = normalizedSearch
    ? clusters.filter((cluster) => {
        const values = [
          cluster.name,
          cluster.node_name,
          cluster.node_ip,
          cluster.context,
          cluster.version,
          cluster.status,
          cluster.node_status,
        ]
        return values.some((value) => String(value ?? '').toLowerCase().includes(normalizedSearch))
      })
    : clusters

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-3 inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
          <p className="text-sm font-semibold text-muted-foreground">加载集群列表...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-semibold text-destructive">{error}</p>
          <button
            type="button"
            onClick={loadClusters}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
          >
            重试
          </button>
        </div>
      </div>
    )
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-foreground">Kubernetes 集群</h1>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">管理通过 Agent 节点连接的 K8s 集群</p>
        </div>
        <button
          type="button"
          onClick={onConnectCluster}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
        >
          连接集群
        </button>
      </div>

      {clusters.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-[14px] border border-border bg-card">
          <div className="text-center">
            <p className="text-sm font-semibold text-muted-foreground">暂无集群</p>
            <p className="mt-1 text-xs text-muted-foreground">点击"连接集群"按钮开始</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-3 shadow-sm">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                value={clusterSearch}
                onChange={(event) => setClusterSearch(event.target.value)}
                placeholder="搜索集群、Agent、IP、Context"
                className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-4 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <span className="shrink-0 rounded-full bg-muted px-3 py-1.5 text-xs font-black text-muted-foreground">
              {filteredClusters.length} / {clusters.length}
            </span>
          </div>

          {filteredClusters.length === 0 ? (
            <div className="flex h-64 items-center justify-center rounded-[14px] border border-dashed border-border bg-card">
              <p className="text-sm font-semibold text-muted-foreground">没有匹配的集群</p>
            </div>
          ) : (
            <div data-testid="k8s-cluster-grid" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredClusters.map((cluster) => (
                <ClusterCard
                  key={cluster.id}
                  cluster={cluster}
                  pendingDelete={pendingDeleteID === cluster.id}
                  onRequestDelete={setPendingDeleteID}
                  onCancelDelete={() => setPendingDeleteID(null)}
                  onConfirmDelete={handleDeleteCluster}
                  onViewDetail={onViewDetail}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

type ClusterCardProps = {
  cluster: K8sCluster
  pendingDelete: boolean
  onRequestDelete: (clusterID: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (clusterID: string) => void
  onViewDetail?: (clusterID: string) => void
}

function ClusterCard({ cluster, pendingDelete, onRequestDelete, onCancelDelete, onConfirmDelete, onViewDetail }: ClusterCardProps) {
  // 集群在线需要同时满足：1. Agent 节点在线；2. K8s API 连接正常
  const isOnline = cluster.node_status === 'online' && cluster.status === 'online'

  return (
    <div className="rounded-[14px] border border-border bg-card p-4 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isOnline ? 'bg-success shadow-[0_0_14px_rgb(var(--success)/0.45)]' : 'bg-muted-foreground/40'}`} />
            <h3 className="truncate text-base font-black text-foreground">{cluster.name}</h3>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            节点: {cluster.node_name} ({cluster.node_ip})
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${isOnline ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
          {isOnline ? '在线' : '离线'}
        </span>
      </div>

      {cluster.version && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <InfoItem label="版本" value={cluster.version} />
          <InfoItem label="节点" value={cluster.node_count?.toString() || '0'} />
          <InfoItem label="命名空间" value={cluster.namespace_count?.toString() || '0'} />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onViewDetail?.(cluster.id)}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground transition hover:bg-muted"
        >
          查看详情
        </button>
        {pendingDelete ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onConfirmDelete(cluster.id)} className="rounded-lg bg-destructive px-3 py-2 text-xs font-bold text-destructive-foreground transition hover:bg-destructive/90">
              确认删除
            </button>
            <button type="button" onClick={onCancelDelete} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-bold text-foreground transition hover:bg-muted">
              取消
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => onRequestDelete(cluster.id)} className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-bold text-destructive transition hover:bg-destructive/20">
            删除
          </button>
        )}
      </div>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-2 py-1.5">
      <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-bold text-foreground">{value}</p>
    </div>
  )
}

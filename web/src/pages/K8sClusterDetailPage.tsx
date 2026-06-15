import { useCallback, useEffect, useState } from 'react'
import { fetchK8sCluster, fetchK8sPods } from '../api/k8s'
import type { K8sCluster, K8sPod } from '../types'
import { Toast } from '../components/Toast'

type K8sClusterDetailPageProps = {
  clusterId: string
  onBack: () => void
}

type DetailTab = 'overview' | 'pods'

export function K8sClusterDetailPage({ clusterId, onBack }: K8sClusterDetailPageProps) {
  const [cluster, setCluster] = useState<K8sCluster>()
  const [pods, setPods] = useState<K8sPod[]>([])
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const [namespace, setNamespace] = useState<string>('')
  const [podSearch, setPodSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [podsLoading, setPodsLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

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

  const loadPods = useCallback(() => {
    setPodsLoading(true)
    fetchK8sPods(clusterId, namespace || undefined)
      .then((response) => {
        if (response.success) {
          setPods(response.pods)
        } else {
          setToast({ message: 'Pod 列表加载失败', type: 'error' })
        }
      })
      .catch((err: Error) => {
        setToast({ message: `Pod 列表加载失败: ${err.message}`, type: 'error' })
      })
      .finally(() => {
        setPodsLoading(false)
      })
  }, [clusterId, namespace])

  useEffect(() => {
    loadCluster()
  }, [loadCluster])

  useEffect(() => {
    if (activeTab === 'pods' && cluster?.status === 'online') {
      loadPods()
    }
  }, [activeTab, cluster?.status, loadPods])

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
      <div className="mb-6 flex gap-2 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 text-sm font-bold transition ${
            activeTab === 'overview'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          概览
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pods')}
          className={`px-4 py-2 text-sm font-bold transition ${
            activeTab === 'pods'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Pod 列表
        </button>
      </div>

      {/* Content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Cluster Info */}
          {cluster.cluster_info && (
            <div className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-4 text-base font-black text-foreground">集群信息</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <InfoCard label="Kubernetes 版本" value={cluster.cluster_info.version} />
                <InfoCard label="节点数量" value={cluster.cluster_info.node_count.toString()} />
                <InfoCard label="命名空间数量" value={cluster.cluster_info.namespace_count.toString()} />
              </div>
            </div>
          )}

          {/* Connection Info */}
          <div className="rounded-[14px] border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-4 text-base font-black text-foreground">连接信息</h3>
            <div className="space-y-3">
              <InfoRow label="kubeconfig 路径" value={cluster.kubeconfig_path} />
              {cluster.context && <InfoRow label="Context" value={cluster.context} />}
              <InfoRow label="创建时间" value={new Date(cluster.created_at).toLocaleString('zh-CN')} />
              {cluster.last_seen_at && (
                <InfoRow label="最后连接时间" value={new Date(cluster.last_seen_at).toLocaleString('zh-CN')} />
              )}
            </div>
          </div>
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
              onClick={loadPods}
              disabled={podsLoading || !isOnline}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {podsLoading ? '加载中...' : '刷新'}
            </button>
          </div>

          {/* Pods List */}
          {!isOnline ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">集群离线，无法查看 Pod 列表</p>
            </div>
          ) : podsLoading ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
              <p className="text-sm font-semibold text-muted-foreground">加载 Pod 列表...</p>
            </div>
          ) : filteredPods.length === 0 ? (
            <div className="rounded-[14px] border border-border bg-card p-8 text-center">
              <p className="text-sm font-semibold text-muted-foreground">
                {pods.length === 0 ? '暂无 Pod' : '没有匹配的 Pod'}
              </p>
            </div>
          ) : (
            <div className="rounded-[14px] border border-border bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">名称</th>
                      <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">命名空间</th>
                      <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">状态</th>
                      <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">就绪</th>
                      <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">重启次数</th>
                      <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">节点</th>
                      <th className="px-4 py-3 text-left text-xs font-black uppercase tracking-wider text-muted-foreground">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPods.map((pod, index) => (
                      <tr key={`${pod.namespace}/${pod.name}`} className={index % 2 === 0 ? 'bg-card' : 'bg-muted/10'}>
                        <td className="px-4 py-3 text-sm font-semibold text-foreground">{pod.name}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{pod.namespace}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-1 text-xs font-bold ${
                            pod.status === 'Running' ? 'bg-success/10 text-success' :
                            pod.status === 'Pending' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' :
                            'bg-destructive/10 text-destructive'
                          }`}>
                            {pod.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{pod.ready}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{pod.restarts}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-muted-foreground">{pod.node}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="rounded-lg border border-border bg-surface px-3 py-1 text-xs font-bold text-foreground transition hover:bg-muted"
                          >
                            查看日志
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
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

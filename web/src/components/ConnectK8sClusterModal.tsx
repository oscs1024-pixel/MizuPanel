import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { connectK8sCluster } from '../api/k8s'
import type { ConnectK8sClusterRequest, Node } from '../types'
import { Toast } from './Toast'

type ConnectK8sClusterModalProps = {
  open: boolean
  nodes: Node[]
  onClose: () => void
  onSuccess: () => void
}

export default function ConnectK8sClusterModal({ open, nodes, onClose, onSuccess }: ConnectK8sClusterModalProps) {
  const [name, setName] = useState('')
  const [nodeId, setNodeId] = useState('')
  const [kubeconfigContent, setKubeconfigContent] = useState('')
  const [context, setContext] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (open && nodes.length > 0 && !nodeId) {
      setNodeId(nodes[0].id)
    }
  }, [open, nodes, nodeId])

  useEffect(() => {
    if (!open) {
      setName('')
      setNodeId(nodes.length > 0 ? nodes[0].id : '')
      setKubeconfigContent('')
      setContext('')
      setConnecting(false)
      setError(undefined)
    }
  }, [open, nodes])

  const handleConnect = () => {
    if (!name.trim()) {
      setError('请输入集群名称')
      return
    }
    if (!nodeId) {
      setError('请选择 Agent 节点')
      return
    }
    if (!kubeconfigContent.trim()) {
      setError('请输入 kubeconfig 内容')
      return
    }

    setConnecting(true)
    setError(undefined)

    const request: ConnectK8sClusterRequest = {
      name: name.trim(),
      node_id: nodeId,
      kubeconfig_content: kubeconfigContent.trim(),
      context: context.trim() || undefined
    }

    connectK8sCluster(request)
      .then(() => {
        setToast({ message: '集群连接成功', type: 'success' })
        setTimeout(() => {
          onClose()
          onSuccess()
        }, 1000)
      })
      .catch((err: Error) => {
        setError(err.message)
        setToast({ message: `集群连接失败: ${err.message}`, type: 'error' })
      })
      .finally(() => {
        setConnecting(false)
      })
  }

  if (!open) return null

  const onlineNodes = nodes.filter((node) => node.status === 'online')

  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div
        className="soft-modal-overlay fixed inset-0 z-50 flex items-center justify-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div className="soft-modal-shell w-full max-w-2xl">
          <div className="soft-modal-header mb-6 flex items-center justify-between border-b px-6 py-5">
            <div>
              <h2 className="text-xl font-black text-foreground">连接 K8s 集群</h2>
              <p className="mt-1 text-sm text-muted-foreground">上传或粘贴 kubeconfig 内容，通过选定 Agent 访问集群</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="soft-button inline-flex h-9 w-9 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="关闭"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-4 px-6 pb-6">
            {/* Cluster Name */}
            <div>
              <label htmlFor="cluster-name" className="mb-2 block text-sm font-bold text-foreground">
                集群名称 <span className="text-danger">*</span>
              </label>
              <input
                id="cluster-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: production-k8s"
                className="soft-input w-full px-4 py-2.5 text-sm font-semibold placeholder:text-muted-foreground"
              />
            </div>

            {/* Node Selection */}
            <div>
              <label htmlFor="node-select" className="mb-2 block text-sm font-bold text-foreground">
                Agent 节点 <span className="text-danger">*</span>
              </label>
              {onlineNodes.length === 0 ? (
                <div className="soft-empty-state px-4 py-3 text-sm text-muted-foreground">
                  当前没有在线的 Agent 节点
                </div>
              ) : (
                <select
                  id="node-select"
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                  className="soft-input w-full px-4 py-2.5 text-sm font-semibold"
                >
                  {onlineNodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name || node.hostname} ({node.ip})
                    </option>
                  ))}
                </select>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                选择网络可以访问 Kubernetes API Server 的 Agent 节点
              </p>
            </div>

            {/* Kubeconfig Content */}
            <div>
              <label htmlFor="kubeconfig-content" className="mb-2 block text-sm font-bold text-foreground">
                kubeconfig 内容 <span className="text-danger">*</span>
              </label>
              <textarea
                id="kubeconfig-content"
                value={kubeconfigContent}
                onChange={(e) => setKubeconfigContent(e.target.value)}
                placeholder={"apiVersion: v1\nkind: Config\nclusters:\n  - cluster: ..."}
                rows={10}
                className="soft-input w-full px-4 py-2.5 font-mono text-xs font-semibold placeholder:text-muted-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                kubeconfig 内容会保存在本地 Server 数据库中，不会在页面详情或日志中展示。
              </p>
            </div>

            {/* Context (Optional) */}
            <div>
              <label htmlFor="context" className="mb-2 block text-sm font-bold text-foreground">
                Context (可选)
              </label>
              <input
                id="context"
                type="text"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="留空使用默认 context"
                className="soft-input w-full px-4 py-2.5 text-sm font-semibold placeholder:text-muted-foreground"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
                {error}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="soft-modal-footer flex justify-end gap-3 border-t px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={connecting}
              className="soft-button border border-border bg-surface px-4 py-2 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting || onlineNodes.length === 0}
              className="soft-button bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {connecting ? '连接中...' : '连接集群'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

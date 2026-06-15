import { useEffect, useRef, useState } from 'react'
import { fetchK8sPodLogs } from '../api/k8s'

interface K8sPodLogsModalProps {
  clusterId: string
  namespace: string
  podName: string
  open: boolean
  onClose: () => void
}

export default function K8sPodLogsModal({
  clusterId,
  namespace,
  podName,
  open,
  onClose,
}: K8sPodLogsModalProps) {
  const [container, setContainer] = useState('')
  const [tailLines, setTailLines] = useState(100)
  const [logContent, setLogContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  const logContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    fetchLogs()
  }, [open, clusterId, namespace, podName, container, tailLines])

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logContent, autoScroll])

  useEffect(() => {
    if (!open) {
      setContainer('')
      setTailLines(100)
      setLogContent('')
      setError('')
      setSearchQuery('')
      setAutoScroll(true)
    }
  }, [open])

  const fetchLogs = () => {
    setLoading(true)
    setError('')
    setLogContent('')

    fetchK8sPodLogs(clusterId, namespace, podName, container || undefined, false, tailLines)
      .then((response) => {
        if (response.success) {
          setLogContent(response.logs)
        } else {
          setError('日志获取失败')
        }
      })
      .catch((err: Error) => {
        setError(err.message)
      })
      .finally(() => {
        setLoading(false)
      })
  }

  const handleRefresh = () => {
    fetchLogs()
  }

  const handleDownload = () => {
    const blob = new Blob([logContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${namespace}-${podName}-logs.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleScroll = () => {
    if (!logContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current
    const isAtBottom = Math.abs(scrollHeight - scrollTop - clientHeight) < 10
    setAutoScroll(isAtBottom)
  }

  if (!open) return null

  const filteredContent = searchQuery
    ? logContent.split('\n').filter((line) => line.toLowerCase().includes(searchQuery.toLowerCase())).join('\n')
    : logContent

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="flex h-[80vh] w-full max-w-6xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="text-lg font-black text-foreground">Pod 日志</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {namespace}/{podName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <input
            type="text"
            value={container}
            onChange={(e) => setContainer(e.target.value)}
            placeholder="容器名称 (可选)"
            className="w-40 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />

          <select
            value={tailLines}
            onChange={(e) => setTailLines(Number(e.target.value))}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value={50}>最后 50 行</option>
            <option value={100}>最后 100 行</option>
            <option value={200}>最后 200 行</option>
            <option value={500}>最后 500 行</option>
            <option value={1000}>最后 1000 行</option>
          </select>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索日志..."
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />

          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-bold text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            {loading ? '加载中...' : '刷新'}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!logContent}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-bold text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            下载
          </button>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-sm font-semibold text-foreground">自动滚动</span>
          </label>
        </div>

        {/* Log Content */}
        <div className="flex-1 overflow-hidden">
          {error ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-semibold text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
                >
                  重试
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <div className="mb-3 inline-block h-6 w-6 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
                <p className="text-sm font-semibold text-muted-foreground">加载日志...</p>
              </div>
            </div>
          ) : !logContent ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm font-semibold text-muted-foreground">暂无日志</p>
            </div>
          ) : (
            <div
              ref={logContainerRef}
              onScroll={handleScroll}
              className="h-full overflow-auto bg-slate-950 p-4 font-mono text-xs text-slate-100"
            >
              <pre className="whitespace-pre-wrap break-words">{filteredContent}</pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            {searchQuery ? `筛选结果：${filteredContent.split('\n').length} 行` : `总计：${logContent.split('\n').length} 行`}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

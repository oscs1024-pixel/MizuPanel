import { useEffect, useState } from 'react'
import { getAlertHistory } from '../api/client'
import type { AlertHistory, Node } from '../types'
import { Search } from 'lucide-react'

type AlertHistoryTabProps = {
  nodes: Node[]
}

type FilterStatus = 'all' | 'active' | 'resolved'

export function AlertHistoryTab({ nodes }: AlertHistoryTabProps) {
  const [alertHistory, setAlertHistory] = useState<AlertHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [filterNode, setFilterNode] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  console.log('AlertHistoryTab rendered, nodes:', nodes.length, 'loading:', loading, 'alerts:', alertHistory.length)

  // 加载告警历史
  const loadAlertHistory = () => {
    if (nodes.length === 0) {
      setAlertHistory([])
      setLoading(false)
      return
    }

    setLoading(true)
    Promise.all(
      nodes.map((node) =>
        getAlertHistory(node.id, 100).catch(() => ({ history: [] }))
      )
    ).then((results) => {
      const allHistory = results.flatMap((r) => r.history).filter(Boolean)
      const sorted = allHistory.sort(
        (a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime()
      )
      setAlertHistory(sorted)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }

  // 初始加载
  useEffect(() => {
    loadAlertHistory()
  }, [nodes])

  // 定时刷新活跃告警（每30秒）
  useEffect(() => {
    const interval = setInterval(() => {
      loadAlertHistory()
    }, 30000)

    return () => clearInterval(interval)
  }, [nodes])

  // 过滤逻辑
  const filteredAlerts = alertHistory.filter((alert) => {
    // 状态过滤
    if (filterStatus === 'active' && alert.resolved_at) return false
    if (filterStatus === 'resolved' && !alert.resolved_at) return false

    // 节点过滤
    if (filterNode !== 'all' && alert.node_id !== filterNode) return false

    // 搜索过滤
    if (searchQuery && !alert.rule_name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false
    }

    return true
  })

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).replace(/\//g, '-')
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm font-semibold text-muted-foreground">加载中...</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 状态筛选按钮组 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              filterStatus === 'all'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('active')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              filterStatus === 'active'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            活跃
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('resolved')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              filterStatus === 'resolved'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            已解决
          </button>
        </div>

        {/* 搜索框 */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索规则名称..."
            className="w-full rounded-md border border-border bg-card py-1.5 pl-9 pr-3 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* 节点筛选下拉 */}
        <select
          value={filterNode}
          onChange={(e) => setFilterNode(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
        >
          <option value="all">所有节点</option>
          {nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name || node.hostname}
            </option>
          ))}
        </select>
      </div>

      {/* 告警卡片列表 */}
      <div className="space-y-3">
        {filteredAlerts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-success/30 bg-success/5 p-12 text-center">
            <p className="text-sm font-black text-success">✓ 太棒了！目前没有{filterStatus === 'active' ? '活跃' : ''}告警</p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {filterStatus === 'all' ? '所有监控指标正常' : filterStatus === 'active' ? '所有监控指标正常' : '没有已解决的告警记录'}
            </p>
          </div>
        ) : (
          filteredAlerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} formatTimestamp={formatTimestamp} />
          ))
        )}
      </div>
    </div>
  )
}

function AlertCard({
  alert,
  formatTimestamp
}: {
  alert: AlertHistory
  formatTimestamp: (ts: string) => string
}) {
  const isActive = !alert.resolved_at

  return (
    <div
      className={`rounded-lg border-l-4 p-4 shadow-sm ${
        isActive
          ? 'border-red-500 bg-red-50'
          : 'border-gray-300 bg-gray-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-foreground">{alert.rule_name}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                isActive
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-200 text-gray-700'
              }`}
            >
              {isActive ? '活跃' : '已解决'}
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            节点: {alert.node_name} · {alert.metric_field}: {alert.metric_value.toFixed(1)}% {'>'} {alert.threshold}%
          </p>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {isActive ? (
              <>触发时间: {formatTimestamp(alert.triggered_at)}</>
            ) : (
              <>触发: {formatTimestamp(alert.triggered_at)} · 解决: {formatTimestamp(alert.resolved_at!)}</>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

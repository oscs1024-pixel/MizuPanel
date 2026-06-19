import type { K8sPod } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'

type K8sPodTableProps = {
  items: K8sPod[]
  loading?: boolean
  onViewLogs: (namespace: string, name: string) => void
}

export function K8sPodTable({ items, loading, onViewLogs }: K8sPodTableProps) {
  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Pod"
      getKey={(item) => `${item.namespace}/${item.name}`}
      columns={[
        { key: 'name', title: '名称', render: (item) => item.name },
        { key: 'namespace', title: '命名空间', render: (item) => <span className="text-muted-foreground">{item.namespace}</span> },
        {
          key: 'status',
          title: '状态',
          render: (item) => (
            <span className={`rounded-full px-2 py-1 text-xs font-bold ${
              item.status === 'Running' ? 'bg-success/10 text-success' :
              item.status === 'Pending' ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' :
              'bg-destructive/10 text-destructive'
            }`}>
              {item.status}
            </span>
          )
        },
        { key: 'ready', title: '就绪', render: (item) => <span className="text-muted-foreground">{item.ready}</span> },
        { key: 'restarts', title: '重启次数', render: (item) => <span className="text-muted-foreground">{item.restarts}</span> },
        { key: 'node', title: '节点', render: (item) => <span className="text-muted-foreground">{item.node}</span> },
        {
          key: 'actions',
          title: '操作',
          render: (item) => (
            <button
              type="button"
              onClick={() => onViewLogs(item.namespace, item.name)}
              className="rounded-lg border border-border bg-surface px-3 py-1 text-xs font-bold text-foreground transition hover:bg-muted"
            >
              查看日志
            </button>
          )
        },
      ]}
    />
  )
}

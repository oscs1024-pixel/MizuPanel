import type { K8sPod } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'
import { K8sStatusBadge } from './K8sStatusBadge'

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
        { key: 'name', title: '名称', render: (item) => <span className="block max-w-[150px] truncate font-black text-foreground" title={item.name}>{item.name}</span> },
        { key: 'namespace', title: '命名空间', render: (item) => <span className="block max-w-[100px] truncate text-muted-foreground" title={item.namespace}>{item.namespace}</span> },
        { key: 'status', title: '状态', render: (item) => <K8sStatusBadge status={item.status} /> },
        { key: 'ready', title: 'Ready', render: (item) => <span className="text-muted-foreground">{item.ready}</span> },
        { key: 'restarts', title: '重启', render: (item) => <span className={item.restarts > 0 ? 'text-warning' : 'text-muted-foreground'}>{item.restarts}</span> },
        { key: 'node', title: '运行节点', render: (item) => <span className="text-muted-foreground">{item.node || '-'}</span> },
        { key: 'ip', title: 'Pod IP', render: (item) => <span className="text-muted-foreground">{item.ip || '-'}</span> },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
        {
          key: 'actions',
          title: '操作',
          render: (item) => (
            <button
              type="button"
              onClick={() => onViewLogs(item.namespace, item.name)}
              className="rounded-lg border border-border bg-surface px-3 py-1 text-xs font-bold text-foreground transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
            >
              查看日志
            </button>
          )
        },
      ]}
    />
  )
}

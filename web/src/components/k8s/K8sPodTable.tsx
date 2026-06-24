import type { K8sPod, K8sResourceKind } from '../../types'
import { K8sResourceActions } from './K8sResourceActions'
import { K8sResourceTable } from './K8sResourceTable'
import { K8sStatusBadge } from './K8sStatusBadge'

type K8sPodTableProps = {
  clusterId: string
  items: K8sPod[]
  loading?: boolean
  onViewLogs: (namespace: string, name: string) => void
  onViewDiagnostics?: (kind: K8sResourceKind, namespace: string, name: string) => void
  onToast: (message: string, type: 'success' | 'error') => void
  onResourceChanged?: () => void
}

export function K8sPodTable({ clusterId, items, loading, onViewLogs, onViewDiagnostics, onToast, onResourceChanged }: K8sPodTableProps) {
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
          align: 'center',
          render: (item) => (
            <K8sResourceActions
              clusterId={clusterId}
              kind="pod"
              namespace={item.namespace}
              name={item.name}
              onViewDiagnostics={onViewDiagnostics}
              onViewLogs={onViewLogs}
              onToast={onToast}
              onResourceChanged={onResourceChanged}
            />
          )
        },
      ]}
    />
  )
}

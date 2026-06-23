import type { K8sNamespace } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'
import { K8sStatusBadge } from './K8sStatusBadge'

export function K8sNamespaceTable({ items, loading }: { items: K8sNamespace[]; loading?: boolean }) {
  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Namespace"
      getKey={(item) => item.name}
      columns={[
        { key: 'name', title: '名称', render: (item) => <span className="block max-w-[200px] truncate font-black text-foreground" title={item.name}>{item.name}</span> },
        { key: 'status', title: '状态', render: (item) => <K8sStatusBadge status={item.status} /> },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
      ]}
    />
  )
}

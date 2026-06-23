import type { K8sNode } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'
import { K8sStatusBadge } from './K8sStatusBadge'

export function K8sNodeTable({ items, loading }: { items: K8sNode[]; loading?: boolean }) {
  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Node"
      getKey={(item) => item.name}
      columns={[
        { key: 'name', title: '名称', render: (item) => <span className="block max-w-[240px] truncate font-black text-foreground" title={item.name}>{item.name}</span> },
        { key: 'status', title: '状态', render: (item) => <K8sStatusBadge status={item.status} /> },
        { key: 'roles', title: '角色', render: (item) => <span className="text-muted-foreground">{item.roles}</span> },
        { key: 'version', title: '版本', render: (item) => <span className="text-muted-foreground">{item.version}</span> },
        { key: 'internal_ip', title: 'Internal IP', render: (item) => <span className="text-muted-foreground">{item.internal_ip}</span> },
        { key: 'pod_cidr', title: 'Pod CIDR', render: (item) => <span className="text-muted-foreground">{item.pod_cidr || '-'}</span> },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
      ]}
    />
  )
}

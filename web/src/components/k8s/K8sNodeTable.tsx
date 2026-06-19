import type { K8sNode } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'

export function K8sNodeTable({ items, loading }: { items: K8sNode[]; loading?: boolean }) {
  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Node"
      getKey={(item) => item.name}
      columns={[
        { key: 'name', title: '名称', render: (item) => item.name },
        { key: 'status', title: '状态', render: (item) => item.status },
        { key: 'roles', title: '角色', render: (item) => item.roles },
        { key: 'version', title: '版本', render: (item) => item.version },
        { key: 'internal_ip', title: '内网 IP', render: (item) => item.internal_ip },
        { key: 'pod_cidr', title: 'Pod CIDR', render: (item) => item.pod_cidr || '-' },
        { key: 'age', title: 'Age', render: (item) => item.age },
      ]}
    />
  )
}

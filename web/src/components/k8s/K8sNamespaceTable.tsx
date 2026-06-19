import type { K8sNamespace } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'

export function K8sNamespaceTable({ items, loading }: { items: K8sNamespace[]; loading?: boolean }) {
  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Namespace"
      getKey={(item) => item.name}
      columns={[
        { key: 'name', title: '名称', render: (item) => item.name },
        { key: 'status', title: '状态', render: (item) => item.status },
        { key: 'age', title: 'Age', render: (item) => item.age },
      ]}
    />
  )
}

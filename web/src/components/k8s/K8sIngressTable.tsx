import type { K8sIngress } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'

export function K8sIngressTable({ items, loading }: { items: K8sIngress[]; loading?: boolean }) {
  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Ingress"
      getKey={(item) => `${item.namespace}/${item.name}`}
      columns={[
        { key: 'name', title: '名称', render: (item) => item.name },
        { key: 'namespace', title: '命名空间', render: (item) => <span className="text-muted-foreground">{item.namespace}</span> },
        { key: 'class', title: 'Class', render: (item) => <span className="text-muted-foreground">{item.class || '-'}</span> },
        { key: 'hosts', title: 'Hosts', render: (item) => <span className="text-muted-foreground">{item.hosts}</span> },
        { key: 'address', title: 'Address', render: (item) => <span className="text-muted-foreground">{item.address || '-'}</span> },
        { key: 'ports', title: 'Ports', render: (item) => <span className="text-muted-foreground">{item.ports}</span> },
        { key: 'age', title: 'Age', render: (item) => item.age },
      ]}
    />
  )
}

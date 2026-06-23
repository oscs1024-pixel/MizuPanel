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
        { key: 'name', title: '名称', render: (item) => <span className="block max-w-[180px] truncate font-black text-foreground" title={item.name}>{item.name}</span> },
        { key: 'namespace', title: '命名空间', render: (item) => <span className="block max-w-[120px] truncate text-muted-foreground" title={item.namespace}>{item.namespace}</span> },
        { key: 'class', title: 'Class', render: (item) => <span className="text-muted-foreground">{item.class || '-'}</span> },
        { key: 'hosts', title: 'Hosts', render: (item) => <span className="block max-w-[260px] truncate text-muted-foreground" title={item.hosts}>{item.hosts}</span> },
        { key: 'address', title: 'Address', render: (item) => <span className="block max-w-[220px] truncate text-muted-foreground" title={item.address || '-'}>{item.address || '-'}</span> },
        { key: 'ports', title: 'Ports', render: (item) => <span className="text-muted-foreground">{item.ports}</span> },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
      ]}
    />
  )
}

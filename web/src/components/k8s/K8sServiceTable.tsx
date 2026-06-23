import type { K8sService } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'

export function K8sServiceTable({ items, loading }: { items: K8sService[]; loading?: boolean }) {
  return (
    <K8sResourceTable
      items={items}
      loading={loading}
      emptyText="暂无 Service"
      getKey={(item) => `${item.namespace}/${item.name}`}
      columns={[
        { key: 'name', title: '名称', render: (item) => <span className="block max-w-[180px] truncate font-black text-foreground" title={item.name}>{item.name}</span> },
        { key: 'namespace', title: '命名空间', render: (item) => <span className="block max-w-[120px] truncate text-muted-foreground" title={item.namespace}>{item.namespace}</span> },
        { key: 'type', title: '类型', render: (item) => item.type },
        { key: 'cluster_ip', title: 'Cluster IP', render: (item) => <span className="text-muted-foreground">{item.cluster_ip}</span> },
        { key: 'external_ip', title: 'External IP', render: (item) => <span className="text-muted-foreground">{item.external_ip || '-'}</span> },
        { key: 'ports', title: 'Ports', render: (item) => <span className="block max-w-[220px] truncate text-muted-foreground" title={item.ports}>{item.ports}</span> },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
      ]}
    />
  )
}

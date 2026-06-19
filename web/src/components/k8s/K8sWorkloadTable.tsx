import type { K8sDeployment, K8sStatefulSet, K8sDaemonSet } from '../../types'
import { K8sResourceTable } from './K8sResourceTable'

type WorkloadMode = 'deployment' | 'statefulset' | 'daemonset'

type K8sWorkloadTableProps = {
  mode: WorkloadMode
  items: K8sDeployment[] | K8sStatefulSet[] | K8sDaemonSet[]
  loading?: boolean
}

export function K8sWorkloadTable({ mode, items, loading }: K8sWorkloadTableProps) {
  if (mode === 'deployment') {
    const deployments = items as K8sDeployment[]
    return (
      <K8sResourceTable
        items={deployments}
        loading={loading}
        emptyText="暂无 Deployment"
        getKey={(item) => `${item.namespace}/${item.name}`}
        columns={[
          { key: 'name', title: '名称', render: (item) => item.name },
          { key: 'namespace', title: '命名空间', render: (item) => <span className="text-muted-foreground">{item.namespace}</span> },
          { key: 'ready', title: 'Ready', render: (item) => item.ready },
          { key: 'up_to_date', title: 'Up-to-date', render: (item) => item.up_to_date },
          { key: 'available', title: 'Available', render: (item) => item.available },
          { key: 'age', title: 'Age', render: (item) => item.age },
        ]}
      />
    )
  }

  if (mode === 'statefulset') {
    const statefulsets = items as K8sStatefulSet[]
    return (
      <K8sResourceTable
        items={statefulsets}
        loading={loading}
        emptyText="暂无 StatefulSet"
        getKey={(item) => `${item.namespace}/${item.name}`}
        columns={[
          { key: 'name', title: '名称', render: (item) => item.name },
          { key: 'namespace', title: '命名空间', render: (item) => <span className="text-muted-foreground">{item.namespace}</span> },
          { key: 'ready', title: 'Ready', render: (item) => item.ready },
          { key: 'service_name', title: 'Service', render: (item) => <span className="text-muted-foreground">{item.service_name}</span> },
          { key: 'age', title: 'Age', render: (item) => item.age },
        ]}
      />
    )
  }

  // daemonset
  const daemonsets = items as K8sDaemonSet[]
  return (
    <K8sResourceTable
      items={daemonsets}
      loading={loading}
      emptyText="暂无 DaemonSet"
      getKey={(item) => `${item.namespace}/${item.name}`}
      columns={[
        { key: 'name', title: '名称', render: (item) => item.name },
        { key: 'namespace', title: '命名空间', render: (item) => <span className="text-muted-foreground">{item.namespace}</span> },
        { key: 'desired', title: 'Desired', render: (item) => item.desired },
        { key: 'current', title: 'Current', render: (item) => item.current },
        { key: 'ready', title: 'Ready', render: (item) => item.ready },
        { key: 'available', title: 'Available', render: (item) => item.available },
        { key: 'age', title: 'Age', render: (item) => item.age },
      ]}
    />
  )
}

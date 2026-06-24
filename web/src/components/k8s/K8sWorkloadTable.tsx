import type { K8sDeployment, K8sStatefulSet, K8sDaemonSet, K8sResourceKind } from '../../types'
import { K8sResourceActions } from './K8sResourceActions'
import { K8sResourceTable } from './K8sResourceTable'

type WorkloadMode = 'deployment' | 'statefulset' | 'daemonset'

type K8sWorkloadTableProps = {
  clusterId: string
  mode: WorkloadMode
  items: K8sDeployment[] | K8sStatefulSet[] | K8sDaemonSet[]
  loading?: boolean
  onViewDiagnostics?: (kind: K8sResourceKind, namespace: string, name: string) => void
  onToast: (message: string, type: 'success' | 'error') => void
  onResourceChanged?: () => void
}

function ResourceName({ name }: { name: string }) {
  return <span className="block max-w-[200px] truncate font-black text-foreground" title={name}>{name}</span>
}

function NamespaceName({ namespace }: { namespace: string }) {
  return <span className="block max-w-[120px] truncate text-muted-foreground" title={namespace}>{namespace}</span>
}

function desiredReplicasFromReady(ready: string): number | undefined {
  const desired = Number.parseInt((ready || '').split('/')[1] || '', 10)
  return Number.isFinite(desired) && desired >= 0 ? desired : undefined
}

export function K8sWorkloadTable({ clusterId, mode, items, loading, onViewDiagnostics, onToast, onResourceChanged }: K8sWorkloadTableProps) {
  if (mode === 'deployment') {
    const deployments = items as K8sDeployment[]
    return (
      <K8sResourceTable
        items={deployments}
        loading={loading}
        emptyText="暂无 Deployment"
        getKey={(item) => `${item.namespace}/${item.name}`}
        columns={[
          { key: 'name', title: '名称', render: (item) => <ResourceName name={item.name} /> },
          { key: 'namespace', title: '命名空间', render: (item) => <NamespaceName namespace={item.namespace} /> },
          { key: 'ready', title: 'Ready', render: (item) => item.ready },
          { key: 'up_to_date', title: 'Up-to-date', render: (item) => item.up_to_date },
          { key: 'available', title: 'Available', render: (item) => item.available },
          { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
          {
            key: 'actions',
            title: '操作',
            align: 'center',
            render: (item) => (
              <K8sResourceActions
                clusterId={clusterId}
                kind="deployment"
                namespace={item.namespace}
                name={item.name}
                replicas={desiredReplicasFromReady(item.ready)}
                onViewDiagnostics={onViewDiagnostics}
                onToast={onToast}
                onResourceChanged={onResourceChanged}
              />
            )
          },
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
          { key: 'name', title: '名称', render: (item) => <ResourceName name={item.name} /> },
          { key: 'namespace', title: '命名空间', render: (item) => <NamespaceName namespace={item.namespace} /> },
          { key: 'ready', title: 'Ready', render: (item) => item.ready },
          { key: 'service_name', title: 'Service', render: (item) => <span className="text-muted-foreground">{item.service_name}</span> },
          { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
          {
            key: 'actions',
            title: '操作',
            align: 'center',
            render: (item) => (
              <K8sResourceActions
                clusterId={clusterId}
                kind="statefulset"
                namespace={item.namespace}
                name={item.name}
                replicas={desiredReplicasFromReady(item.ready)}
                onViewDiagnostics={onViewDiagnostics}
                onToast={onToast}
                onResourceChanged={onResourceChanged}
              />
            )
          },
        ]}
      />
    )
  }

  const daemonsets = items as K8sDaemonSet[]
  return (
    <K8sResourceTable
      items={daemonsets}
      loading={loading}
      emptyText="暂无 DaemonSet"
      getKey={(item) => `${item.namespace}/${item.name}`}
      columns={[
        { key: 'name', title: '名称', render: (item) => <ResourceName name={item.name} /> },
        { key: 'namespace', title: '命名空间', render: (item) => <NamespaceName namespace={item.namespace} /> },
        { key: 'desired', title: 'Desired', render: (item) => item.desired },
        { key: 'current', title: 'Current', render: (item) => item.current },
        { key: 'ready', title: 'Ready', render: (item) => item.ready },
        { key: 'available', title: 'Available', render: (item) => item.available },
        { key: 'age', title: 'Age', render: (item) => <span className="text-muted-foreground">{item.age}</span> },
        {
          key: 'actions',
          title: '操作',
          align: 'center',
          render: (item) => (
            <K8sResourceActions
              clusterId={clusterId}
              kind="daemonset"
              namespace={item.namespace}
              name={item.name}
              onViewDiagnostics={onViewDiagnostics}
              onToast={onToast}
              onResourceChanged={onResourceChanged}
            />
          )
        },
      ]}
    />
  )
}

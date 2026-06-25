import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { K8sWorkloadTable } from './K8sWorkloadTable'

describe('K8sWorkloadTable', () => {
  test('keeps workload metrics in the expanded pod panel instead of the main table', () => {
    render(
      <K8sWorkloadTable
        clusterId="cluster-1"
        mode="deployment"
        items={[{ name: 'web', namespace: 'default', ready: '2/2', up_to_date: 2, available: 2, age: '4h' }]}
        pods={[
          {
            name: 'web-7d9f-heavy',
            namespace: 'default',
            status: 'Running',
            ready: '1/1',
            restarts: 0,
            age: '10m',
            node: 'node-a',
            workload_kind: 'deployment',
            workload_name: 'web',
            metrics_available: true,
            cpu_usage_milli: 25,
            memory_usage_bytes: 96 * 1024 * 1024,
          },
          {
            name: 'web-7d9f-light',
            namespace: 'default',
            status: 'Running',
            ready: '1/1',
            restarts: 1,
            age: '9m',
            node: 'node-b',
            workload_kind: 'deployment',
            workload_name: 'web',
            metrics_available: true,
            cpu_usage_milli: 50,
            memory_usage_bytes: 64 * 1024 * 1024,
          },
          {
            name: 'mysql-0',
            namespace: 'default',
            status: 'Running',
            ready: '1/1',
            restarts: 0,
            age: '1h',
            node: 'node-b',
            workload_kind: 'statefulset',
            workload_name: 'mysql',
            metrics_available: true,
            cpu_usage_milli: 200,
            memory_usage_bytes: 512 * 1024 * 1024,
          },
        ]}
        onToast={vi.fn()}
      />
    )

    expect(screen.queryByRole('columnheader', { name: 'CPU' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '内存' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开 Deployment web Pod 资源' }))

    const panel = screen.getByRole('region', { name: 'web Pod 资源' })
    expect(within(panel).getByText('75m')).toBeInTheDocument()
    expect(within(panel).getByText('160 MB')).toBeInTheDocument()
    expect(within(panel).getByText('1 Pods')).toBeInTheDocument()
    expect(within(panel).queryByText('mysql-0')).not.toBeInTheDocument()

    const podNames = within(panel).getAllByText(/web-7d9f-/).map((item) => item.textContent)
    expect(podNames).toEqual(['web-7d9f-heavy', 'web-7d9f-light'])
  })

  test('shows an owner-aware empty state when pods cannot be matched to the workload', () => {
    render(
      <K8sWorkloadTable
        clusterId="cluster-1"
        mode="statefulset"
        items={[{ name: 'mysql', namespace: 'default', ready: '1/1', service_name: 'mysql', age: '4h' }]}
        pods={[{ name: 'mysql-0', namespace: 'default', status: 'Running', ready: '1/1', restarts: 0, age: '1h', node: 'node-a' }]}
        onToast={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '展开 StatefulSet mysql Pod 资源' }))

    expect(screen.getByText(/Agent 尚未上报 owner 信息/)).toBeInTheDocument()
  })
})

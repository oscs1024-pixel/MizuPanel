import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { K8sNodeTable } from './K8sNodeTable'

describe('K8sNodeTable', () => {
  test('keeps node resources compact and expands top pods on demand', () => {
    render(
      <K8sNodeTable
        items={[
          {
            name: 'master01',
            status: 'Ready',
            roles: 'control-plane',
            version: 'v1.28.15',
            internal_ip: '192.168.98.10',
            pod_cidr: '10.42.0.0/24',
            age: '202d',
            cpu_capacity_milli: 4000,
            cpu_allocatable_milli: 3900,
            memory_capacity_bytes: 8589934592,
            memory_allocatable_bytes: 7516192768,
            pod_capacity: 110,
            pod_allocatable: 100,
          },
        ]}
        pods={[
          {
            name: 'api',
            namespace: 'default',
            status: 'Running',
            ready: '1/1',
            restarts: 1,
            age: '2d',
            node: 'master01',
            metrics_available: true,
            cpu_usage_milli: 220,
            memory_usage_bytes: 268435456,
          },
          {
            name: 'coredns',
            namespace: 'kube-system',
            status: 'Running',
            ready: '1/1',
            restarts: 0,
            age: '198d',
            node: 'master01',
            metrics_available: true,
            cpu_usage_milli: 15,
            memory_usage_bytes: 73400320,
          },
          {
            name: 'pending',
            namespace: 'default',
            status: 'Pending',
            ready: '0/1',
            restarts: 0,
            age: '5m',
            node: '',
            metrics_available: false,
          },
        ]}
      />
    )

    expect(screen.getByRole('columnheader', { name: '资源' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Pods' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'CPU' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '内存' })).not.toBeInTheDocument()
    expect(screen.getByText('235m / 3900m')).toBeInTheDocument()
    expect(screen.getByText('326 MB / 7 GB')).toBeInTheDocument()
    expect(screen.getByText('2 Pods')).toBeInTheDocument()
    expect(screen.getByText('2/2 已上报')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /展开节点 master01 Pod 资源/ }))

    const panel = screen.getByRole('region', { name: 'master01 Pod 资源' })
    expect(within(panel).getByText('Capacity')).toBeInTheDocument()
    expect(within(panel).getByText('4 Core')).toBeInTheDocument()
    expect(within(panel).getByText('8 GB')).toBeInTheDocument()
    expect(within(panel).getByText('Top Pods')).toBeInTheDocument()
    expect(within(panel).getByText('api')).toBeInTheDocument()
    expect(within(panel).getByText('220m')).toBeInTheDocument()
    expect(within(panel).getByText('256 MB')).toBeInTheDocument()
  })
})

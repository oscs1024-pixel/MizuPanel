import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { K8sPodTable } from './K8sPodTable'

describe('K8sPodTable', () => {
  test('keeps resource usage out of the list columns and expands container resource details below the row', () => {
    render(
      <K8sPodTable
        clusterId="cluster-1"
        items={[
          {
            name: 'api-7d9f',
            namespace: 'payments',
            status: 'Running',
            ready: '1/1',
            restarts: 2,
            age: '2d',
            node: 'node-a',
            ip: '10.42.0.11',
            metrics_available: true,
            cpu_usage_milli: 37,
            memory_usage_bytes: 100663296,
            containers: [
              {
                name: 'api',
                image: 'example/api:v1',
                ready: true,
                restart_count: 2,
                state: 'Running',
                cpu_usage_milli: 37,
                memory_usage_bytes: 100663296,
                cpu_request_milli: 100,
                cpu_limit_milli: 500,
                memory_request_bytes: 134217728,
                memory_limit_bytes: 536870912,
              },
            ],
          },
        ]}
        onViewLogs={vi.fn()}
        onToast={vi.fn()}
      />
    )

    expect(screen.queryByRole('columnheader', { name: 'CPU' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: '内存' })).not.toBeInTheDocument()
    expect(screen.queryByText('37m')).not.toBeInTheDocument()
    expect(screen.queryByText('96 MB')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /展开 Pod api-7d9f 资源观测/ }))

    const panel = screen.getByRole('region', { name: 'api-7d9f 资源观测' })
    expect(within(panel).getByText('容器资源')).toBeInTheDocument()
    expect(within(panel).getByText('CPU 37m')).toBeInTheDocument()
    expect(within(panel).getByText('内存 96 MB')).toBeInTheDocument()
    expect(within(panel).getByText('example/api:v1')).toBeInTheDocument()
    expect(within(panel).getByText('请求 100m')).toBeInTheDocument()
    expect(within(panel).getByText('限制 500m')).toBeInTheDocument()
    expect(within(panel).getByText('请求 128 MB')).toBeInTheDocument()
    expect(within(panel).getByText('限制 512 MB')).toBeInTheDocument()
    expect(within(panel).getByText('Running')).toBeInTheDocument()
    expect(within(panel).getByText('重启 2')).toBeInTheDocument()
  })
})

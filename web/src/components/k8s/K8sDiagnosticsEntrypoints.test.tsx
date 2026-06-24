import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { K8sPodTable } from './K8sPodTable'
import { K8sWorkloadTable } from './K8sWorkloadTable'

describe('K8s diagnostics entrypoints', () => {
  test('opens diagnostics from a Pod row', async () => {
    const onViewDiagnostics = vi.fn()

    render(
      <K8sPodTable
        clusterId="cluster-1"
        items={[{ name: 'nginx-abc', namespace: 'default', status: 'Running', ready: '1/1', restarts: 0, age: '2d', node: 'node-1', ip: '10.42.0.8' }]}
        onViewLogs={vi.fn()}
        onViewDiagnostics={onViewDiagnostics}
        onToast={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pod nginx-abc 操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '详情' }))

    expect(onViewDiagnostics).toHaveBeenCalledWith('pod', 'default', 'nginx-abc')
  })

  test('opens diagnostics from a Deployment row', async () => {
    const onViewDiagnostics = vi.fn()

    render(
      <K8sWorkloadTable
        clusterId="cluster-1"
        mode="deployment"
        items={[{ name: 'web', namespace: 'default', ready: '2/3', up_to_date: 3, available: 2, age: '4h' }]}
        onViewDiagnostics={onViewDiagnostics}
        onToast={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deployment web 操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '详情' }))

    expect(onViewDiagnostics).toHaveBeenCalledWith('deployment', 'default', 'web')
  })

  test('centers row actions in the operation column', () => {
    render(
      <K8sPodTable
        clusterId="cluster-1"
        items={[{ name: 'nginx-abc', namespace: 'default', status: 'Running', ready: '1/1', restarts: 0, age: '2d', node: 'node-1', ip: '10.42.0.8' }]}
        onViewLogs={vi.fn()}
        onViewDiagnostics={vi.fn()}
        onToast={vi.fn()}
      />
    )

    expect(screen.getByRole('columnheader', { name: '操作' })).toHaveClass('text-center')
    expect(screen.getByRole('button', { name: 'Pod nginx-abc 操作' }).closest('td')).toHaveClass('text-center')
  })
})

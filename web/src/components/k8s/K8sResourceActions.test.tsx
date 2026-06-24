import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { executeK8sResourceAction } from '../../api/k8s'
import { K8sResourceActions } from './K8sResourceActions'

vi.mock('../../api/k8s', () => ({
  executeK8sResourceAction: vi.fn(),
}))

describe('K8sResourceActions', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  test('opens diagnostics and logs from a Pod row', async () => {
    const onViewDiagnostics = vi.fn()
    const onViewLogs = vi.fn()

    render(
      <K8sResourceActions
        clusterId="cluster-1"
        kind="pod"
        namespace="default"
        name="nginx"
        onViewDiagnostics={onViewDiagnostics}
        onViewLogs={onViewLogs}
        onToast={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pod nginx 操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '详情' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pod nginx 操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '日志' }))

    expect(onViewDiagnostics).toHaveBeenCalledWith('pod', 'default', 'nginx')
    expect(onViewLogs).toHaveBeenCalledWith('default', 'nginx')
  })

  test('restarts a workload from the row action menu', async () => {
    const onToast = vi.fn()
    const onResourceChanged = vi.fn()
    vi.mocked(executeK8sResourceAction).mockResolvedValue({ success: true, message: '重启成功' })

    render(
      <K8sResourceActions
        clusterId="cluster-1"
        kind="deployment"
        namespace="default"
        name="web"
        onToast={onToast}
        onResourceChanged={onResourceChanged}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deployment web 操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '重启' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认重启' }))

    await waitFor(() => {
      expect(executeK8sResourceAction).toHaveBeenCalledWith('cluster-1', 'deployment', 'default', 'web', { action: 'restart' })
    })
    expect(onToast).toHaveBeenCalledWith('Workload重启成功', 'success')
    expect(onResourceChanged).toHaveBeenCalled()
  })

  test('allows clearing and typing replica count before scaling', async () => {
    const onToast = vi.fn()
    const onResourceChanged = vi.fn()
    vi.mocked(executeK8sResourceAction).mockResolvedValue({ success: true, message: '扩缩容成功' })

    render(
      <K8sResourceActions
        clusterId="cluster-1"
        kind="deployment"
        namespace="default"
        name="web"
        replicas={1}
        onToast={onToast}
        onResourceChanged={onResourceChanged}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deployment web 操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '扩缩容' }))

    const replicasInput = await screen.findByLabelText('副本数')
    const confirmButton = screen.getByRole('button', { name: '确认扩缩容' })
    expect(replicasInput).toHaveValue('1')

    fireEvent.change(replicasInput, { target: { value: '' } })
    expect(replicasInput).toHaveValue('')
    expect(confirmButton).toBeDisabled()

    fireEvent.change(replicasInput, { target: { value: '3' } })
    expect(replicasInput).toHaveValue('3')
    expect(confirmButton).not.toBeDisabled()
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(executeK8sResourceAction).toHaveBeenCalledWith('cluster-1', 'deployment', 'default', 'web', { action: 'scale', replicas: 3 })
    })
    expect(onToast).toHaveBeenCalledWith('Workload扩缩容成功', 'success')
    expect(onResourceChanged).toHaveBeenCalled()
  })

  test('renders action modals outside the row container to avoid clipping', async () => {
    const { container } = render(
      <div className="overflow-hidden">
        <K8sResourceActions
          clusterId="cluster-1"
          kind="deployment"
          namespace="default"
          name="web"
          replicas={2}
          onToast={vi.fn()}
        />
      </div>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deployment web 操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '扩缩容' }))

    const dialog = await screen.findByRole('dialog', { name: '扩缩容' })
    expect(document.body).toContainElement(dialog)
    expect(container).not.toContainElement(dialog)
  })

  test('keeps YAML editing out of the row action menu', async () => {
    render(
      <K8sResourceActions
        clusterId="cluster-1"
        kind="deployment"
        namespace="default"
        name="web"
        onViewDiagnostics={vi.fn()}
        onToast={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Deployment web 操作' }))
    await screen.findByRole('button', { name: '详情' })
    expect(screen.queryByRole('button', { name: '编辑 YAML' })).not.toBeInTheDocument()
  })
})

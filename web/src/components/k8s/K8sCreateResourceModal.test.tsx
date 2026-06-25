import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { applyK8sManifest } from '../../api/k8s'
import { K8sCreateResourceModal } from './K8sCreateResourceModal'

vi.mock('../../api/k8s', () => ({
  applyK8sManifest: vi.fn(),
}))

function renderModal(overrides: Partial<Parameters<typeof K8sCreateResourceModal>[0]> = {}) {
  return render(
    <K8sCreateResourceModal
      open
      clusterId="cluster-1"
      currentNamespace="payments"
      namespaces={[
        { name: 'default', status: 'Active', age: '10d' },
        { name: 'payments', status: 'Active', age: '8d' },
      ]}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      onToast={vi.fn()}
      {...overrides}
    />
  )
}

describe('K8sCreateResourceModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(applyK8sManifest).mockResolvedValue({ success: true, message: 'ok' })
  })

  test('defaults the namespace from the current resource filter and previews Deployment YAML', () => {
    renderModal()

    expect(screen.getByRole('dialog', { name: '创建 Kubernetes 资源' })).toBeInTheDocument()
    expect(screen.getByLabelText('目标命名空间')).toHaveValue('payments')
    const preview = screen.getByLabelText('YAML 预览') as HTMLTextAreaElement
    expect(preview.value).toContain('kind: Deployment')
    expect(preview.value).toContain('namespace: payments')
  })

  test('requires a successful dry run before creating resources', async () => {
    const onCreated = vi.fn()
    const onToast = vi.fn()
    renderModal({ onCreated, onToast })

    fireEvent.change(screen.getByLabelText('资源名称'), { target: { value: 'web' } })
    fireEvent.change(screen.getByLabelText('镜像'), { target: { value: 'nginx:1.27' } })
    const createButton = screen.getByRole('button', { name: '创建资源' })
    expect(createButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Dry Run' }))

    await waitFor(() => {
      expect(applyK8sManifest).toHaveBeenCalledWith('cluster-1', expect.objectContaining({
        dry_run: true,
        yaml: expect.stringContaining('name: web'),
      }))
    })
    await waitFor(() => expect(createButton).not.toBeDisabled())

    fireEvent.click(createButton)

    await waitFor(() => {
      expect(applyK8sManifest).toHaveBeenLastCalledWith('cluster-1', expect.objectContaining({
        dry_run: false,
        yaml: expect.stringContaining('image: nginx:1.27'),
      }))
    })
    expect(onCreated).toHaveBeenCalled()
    expect(onToast).toHaveBeenCalledWith('资源创建成功', 'success')
  })

  test('adds a Namespace document when creating into a new namespace', () => {
    renderModal({ currentNamespace: '' })

    fireEvent.change(screen.getByLabelText('目标命名空间'), { target: { value: '__create__' } })
    fireEvent.change(screen.getByLabelText('新命名空间'), { target: { value: 'staging' } })

    const preview = screen.getByLabelText('YAML 预览')
    expect((preview as HTMLTextAreaElement).value).toContain('kind: Namespace')
    expect((preview as HTMLTextAreaElement).value).toContain('name: staging')
    expect((preview as HTMLTextAreaElement).value).toContain('namespace: staging')
  })
})

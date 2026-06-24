import type { MouseEvent, ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, FileText, MoreHorizontal, RotateCw, ScrollText, Trash2 } from 'lucide-react'

import { executeK8sResourceAction } from '../../api/k8s'
import type { K8sResourceActionRequest, K8sResourceKind } from '../../types'

type ActionModal = 'delete' | 'restart' | 'scale' | null

type K8sResourceActionsProps = {
  clusterId: string
  kind: K8sResourceKind
  namespace: string
  name: string
  replicas?: number
  onViewDiagnostics?: (kind: K8sResourceKind, namespace: string, name: string) => void
  onViewLogs?: (namespace: string, name: string) => void
  onToast: (message: string, type: 'success' | 'error') => void
  onResourceChanged?: () => void
}

const kindLabels: Record<K8sResourceKind, string> = {
  pod: 'Pod',
  deployment: 'Deployment',
  statefulset: 'StatefulSet',
  daemonset: 'DaemonSet',
}

export function K8sResourceActions({
  clusterId,
  kind,
  namespace,
  name,
  replicas,
  onViewDiagnostics,
  onViewLogs,
  onToast,
  onResourceChanged,
}: K8sResourceActionsProps) {
  const menuId = useId()
  const initialReplicas = typeof replicas === 'number' && Number.isFinite(replicas) ? replicas : 1
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>()
  const [actionModal, setActionModal] = useState<ActionModal>(null)
  const [submitting, setSubmitting] = useState(false)
  const [replicaInput, setReplicaInput] = useState(String(initialReplicas))

  const canRestart = kind === 'deployment' || kind === 'statefulset' || kind === 'daemonset'
  const canScale = kind === 'deployment' || kind === 'statefulset'
  const canDelete = kind === 'pod'
  const hasMenuActions = Boolean(onViewDiagnostics || (kind === 'pod' && onViewLogs) || canRestart || canScale || canDelete)

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsideClick = (event: globalThis.MouseEvent) => {
      let element = event.target instanceof HTMLElement ? event.target : null
      while (element) {
        if (element.getAttribute('data-k8s-actions-menu') === menuId) return
        element = element.parentElement
      }
      setMenuOpen(false)
    }
    const timeoutID = window.setTimeout(() => {
      document.addEventListener('click', closeOnOutsideClick)
    }, 0)
    return () => {
      window.clearTimeout(timeoutID)
      document.removeEventListener('click', closeOnOutsideClick)
    }
  }, [menuId, menuOpen])

  const toggleMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 176
    setMenuPosition({
      top: rect.bottom + 6,
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
    })
    setMenuOpen((value) => !value)
  }

  const runAction = async (request: K8sResourceActionRequest, successLabel: string) => {
    setSubmitting(true)
    try {
      await executeK8sResourceAction(clusterId, kind, namespace, name, request)
      onToast(`${successLabel}成功`, 'success')
      setActionModal(null)
      setMenuOpen(false)
      onResourceChanged?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      onToast(`${successLabel}失败: ${message}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const openAction = async (modal: ActionModal) => {
    setMenuOpen(false)
    setActionModal(modal)
    if (modal === 'scale') {
      setReplicaInput(String(initialReplicas))
    }
  }

  const openDiagnostics = () => {
    setMenuOpen(false)
    onViewDiagnostics?.(kind, namespace, name)
  }

  const openLogs = () => {
    setMenuOpen(false)
    onViewLogs?.(namespace, name)
  }

  if (!hasMenuActions) return null
  const parsedReplicaCount = parseReplicaInput(replicaInput)

  const runScaleAction = () => {
    if (parsedReplicaCount === null) {
      onToast('Workload扩缩容失败: 副本数必须是非负整数', 'error')
      return
    }
    runAction({ action: 'scale', replicas: parsedReplicaCount }, 'Workload扩缩容')
  }

  return (
    <div className="relative flex items-center justify-center">
      <button
        type="button"
        aria-label={`${kindLabels[kind]} ${name} 操作`}
        title="操作"
        data-k8s-actions-menu={menuId}
        onClick={toggleMenu}
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground shadow-sm transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {menuOpen && menuPosition ? createPortal(
        <div
          data-k8s-actions-menu={menuId}
          className="fixed z-[70] w-44 rounded-2xl border border-border/80 bg-card/95 p-1.5 text-left shadow-[0_18px_45px_rgb(15_23_42/0.16)] backdrop-blur"
          style={{ top: menuPosition.top, left: menuPosition.left }}
          onClick={(event) => event.stopPropagation()}
        >
          {onViewDiagnostics ? <ActionMenuItem icon={<FileText size={15} />} label="详情" onClick={openDiagnostics} /> : null}
          {kind === 'pod' && onViewLogs ? <ActionMenuItem icon={<ScrollText size={15} />} label="日志" onClick={openLogs} /> : null}
          {(canRestart || canScale || canDelete) && (onViewDiagnostics || (kind === 'pod' && onViewLogs)) ? <div className="my-1 h-px bg-border/70" /> : null}
          {canRestart ? <ActionMenuItem icon={<RotateCw size={15} />} label="重启" onClick={() => void openAction('restart')} /> : null}
          {canScale ? <ActionMenuItem icon={<CheckCircle2 size={15} />} label="扩缩容" onClick={() => void openAction('scale')} /> : null}
          {canDelete ? <ActionMenuItem danger icon={<Trash2 size={15} />} label="删除 Pod" onClick={() => void openAction('delete')} /> : null}
        </div>,
        document.body
      ) : null}

      <ConfirmActionModal
        open={actionModal === 'restart'}
        title="重启 Workload"
        body={`将滚动重启 ${kindLabels[kind]} ${name}。`}
        confirmLabel="确认重启"
        submitting={submitting}
        onClose={() => setActionModal(null)}
        onConfirm={() => runAction({ action: 'restart' }, 'Workload重启')}
      />
      <ConfirmActionModal
        open={actionModal === 'delete'}
        title="删除 Pod"
        body={`将删除 Pod ${name}。如果它由控制器管理，Kubernetes 通常会自动重建。`}
        confirmLabel="确认删除"
        danger
        submitting={submitting}
        onClose={() => setActionModal(null)}
        onConfirm={() => runAction({ action: 'delete' }, 'Pod删除')}
      />
      <ScaleModal
        open={actionModal === 'scale'}
        replicas={replicaInput}
        valid={parsedReplicaCount !== null}
        submitting={submitting}
        onReplicasChange={setReplicaInput}
        onClose={() => setActionModal(null)}
        onConfirm={runScaleAction}
      />
    </div>
  )
}

function parseReplicaInput(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function ActionMenuItem({ icon, label, danger, onClick }: { icon: ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-bold transition ${danger ? 'text-danger hover:bg-danger/10' : 'text-foreground hover:bg-primary/10 hover:text-primary'}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  )
}

function ModalShell({ open, title, size = 'md', children, onClose }: { open: boolean; title: string; size?: 'md' | 'wide'; children: ReactNode; onClose: () => void }) {
  if (!open) return null
  const widthClass = size === 'wide' ? 'max-w-4xl' : 'max-w-xl'
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section role="dialog" aria-modal="true" aria-label={title} className={`flex max-h-[90vh] w-full ${widthClass} flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-2xl whitespace-normal`}>
        <header className="border-b border-border px-5 py-4">
          <h3 className="text-lg font-black text-foreground">{title}</h3>
        </header>
        {children}
      </section>
    </div>,
    document.body
  )
}

function ConfirmActionModal({ open, title, body, confirmLabel, danger, submitting, onClose, onConfirm }: { open: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; submitting: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <ModalShell open={open} title={title} onClose={onClose}>
      <div className="p-5">
        <p className="text-sm font-semibold leading-6 text-muted-foreground">{body}</p>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface px-5 py-4">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-foreground transition hover:bg-muted disabled:opacity-50">取消</button>
        <button type="button" onClick={onConfirm} disabled={submitting} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white transition disabled:opacity-50 ${danger ? 'bg-danger hover:bg-danger/90' : 'bg-primary hover:bg-primary/90'}`}>
          {danger ? <Trash2 size={16} aria-hidden="true" /> : <RotateCw size={16} aria-hidden="true" />}
          {submitting ? '执行中' : confirmLabel}
        </button>
      </footer>
    </ModalShell>
  )
}

function ScaleModal({ open, replicas, valid, submitting, onReplicasChange, onClose, onConfirm }: { open: boolean; replicas: string; valid: boolean; submitting: boolean; onReplicasChange: (value: string) => void; onClose: () => void; onConfirm: () => void }) {
  return (
    <ModalShell open={open} title="扩缩容" onClose={onClose}>
      <div className="space-y-2 p-5">
        <label htmlFor="k8s-scale-replicas" className="text-sm font-black text-foreground">副本数</label>
        <input
          id="k8s-scale-replicas"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="0"
          value={replicas}
          onChange={(event) => {
            const nextValue = event.target.value
            if (/^\d*$/.test(nextValue)) onReplicasChange(nextValue)
          }}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm font-semibold tabular-nums text-foreground outline-none transition focus:border-primary"
        />
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface px-5 py-4">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-foreground transition hover:bg-muted disabled:opacity-50">取消</button>
        <button type="button" onClick={onConfirm} disabled={submitting || !valid} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
          <CheckCircle2 size={16} aria-hidden="true" />
          {submitting ? '执行中' : '确认扩缩容'}
        </button>
      </footer>
    </ModalShell>
  )
}

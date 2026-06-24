import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { CheckCircle2, Pencil, Save } from 'lucide-react'

import { executeK8sResourceAction, fetchK8sDiagnostics } from '../../api/k8s'
import type { K8sDiagnostics, K8sResourceActionRequest, K8sResourceKind } from '../../types'
import { K8sStatusBadge } from './K8sStatusBadge'

type DiagnosticsTab = 'overview' | 'events' | 'yaml' | 'describe' | 'logs'

type K8sDiagnosticsDrawerProps = {
  clusterId: string
  resource?: {
    kind: K8sResourceKind
    namespace: string
    name: string
  }
  open: boolean
  onClose: () => void
  onToast: (message: string, type: 'success' | 'error') => void
  onOpenLogs: (namespace: string, name: string) => void
  onResourceChanged?: () => void
}

const kindLabels: Record<K8sResourceKind, string> = {
  pod: 'Pod',
  deployment: 'Deployment',
  statefulset: 'StatefulSet',
  daemonset: 'DaemonSet',
}

async function copyToClipboard(value: string): Promise<void> {
  const clipboard = navigator.clipboard
  if (clipboard) {
    try {
      await clipboard.writeText(value)
      return
    } catch {
      // HTTP machine-IP access can reject the Clipboard API; fall back below.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('浏览器拒绝复制')
}

export function K8sDiagnosticsDrawer({ clusterId, resource, open, onClose, onToast, onOpenLogs, onResourceChanged }: K8sDiagnosticsDrawerProps) {
  const [diagnostics, setDiagnostics] = useState<K8sDiagnostics>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [activeTab, setActiveTab] = useState<DiagnosticsTab>('overview')
  const [yamlEditorOpen, setYamlEditorOpen] = useState(false)
  const [yamlDraft, setYamlDraft] = useState('')
  const [dryRunPassed, setDryRunPassed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadDiagnostics = () => {
    if (!resource) return
    setLoading(true)
    setError(undefined)
    fetchK8sDiagnostics(clusterId, resource.kind, resource.namespace, resource.name)
      .then((response) => {
        setDiagnostics(response.diagnostics)
      })
      .catch((err: Error) => {
        setError(err.message)
        onToast(`诊断信息加载失败: ${err.message}`, 'error')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!open || !resource) return
    setActiveTab('overview')
    setDiagnostics(undefined)
    setYamlEditorOpen(false)
    setYamlDraft('')
    setDryRunPassed(false)
    loadDiagnostics()
  }, [open, clusterId, resource?.kind, resource?.namespace, resource?.name])

  if (!open || !resource) return null

  const tabs: Array<{ key: DiagnosticsTab; label: string }> = [
    { key: 'overview', label: '概览' },
    { key: 'events', label: 'Events' },
    { key: 'yaml', label: 'YAML' },
    { key: 'describe', label: 'Describe' },
  ]
  if (resource.kind === 'pod') tabs.push({ key: 'logs', label: '日志' })

  const copyText = async (label: string, value: string) => {
    try {
      await copyToClipboard(value)
      onToast(`${label}复制成功`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : '浏览器拒绝复制'
      onToast(`${label}复制失败: ${message}`, 'error')
    }
  }

  const openYamlEditor = () => {
    if (!diagnostics) return
    setYamlDraft(diagnostics.yaml || '')
    setDryRunPassed(false)
    setYamlEditorOpen(true)
  }

  const runYamlAction = async (request: K8sResourceActionRequest, successLabel: string) => {
    if (!resource) return
    setSubmitting(true)
    try {
      await executeK8sResourceAction(clusterId, resource.kind, resource.namespace, resource.name, request)
      onToast(`${successLabel}成功`, 'success')
      if (request.action === 'dry_run_apply') {
        setDryRunPassed(true)
        return
      }
      setYamlEditorOpen(false)
      setDryRunPassed(false)
      onResourceChanged?.()
      loadDiagnostics()
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      onToast(`${successLabel}失败: ${message}`, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/35"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <aside className="ml-auto flex h-full w-full max-w-[760px] flex-col border-l border-border bg-background shadow-2xl">
          <header className="border-b border-border bg-card px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wider text-primary">{kindLabels[resource.kind]}</p>
                <h2 className="mt-1 truncate text-xl font-black text-foreground">{resource.name}</h2>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">{resource.namespace}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={loadDiagnostics} disabled={loading} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-black text-foreground transition hover:bg-muted disabled:opacity-50">
                  {loading ? '加载中' : '刷新'}
                </button>
                <button type="button" onClick={onClose} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-black text-foreground transition hover:bg-muted">
                  关闭
                </button>
              </div>
            </div>
          </header>

          <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4 py-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-3 py-2 text-xs font-black transition ${activeTab === tab.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-auto p-5">
            {loading ? (
              <DrawerState text="加载诊断信息..." />
            ) : error ? (
              <div className="rounded-[16px] border border-danger/30 bg-danger/5 p-6 text-center">
                <p className="text-sm font-bold text-danger">{error}</p>
                <button type="button" onClick={loadDiagnostics} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90">重试</button>
              </div>
            ) : !diagnostics ? (
              <DrawerState text="暂无诊断信息" />
            ) : (
              <DiagnosticsContent
                activeTab={activeTab}
                diagnostics={diagnostics}
                onCopy={copyText}
                onEditYAML={openYamlEditor}
                onOpenLogs={() => onOpenLogs(resource.namespace, resource.name)}
              />
            )}
          </div>
        </aside>
      </div>

      <YAMLEditModal
        open={yamlEditorOpen}
        value={yamlDraft}
        dryRunPassed={dryRunPassed}
        submitting={submitting}
        onChange={(value) => {
          setYamlDraft(value)
          setDryRunPassed(false)
        }}
        onClose={() => setYamlEditorOpen(false)}
        onDryRun={() => runYamlAction({ action: 'dry_run_apply', yaml: yamlDraft }, 'YAML校验')}
        onSave={() => runYamlAction({ action: 'apply', yaml: yamlDraft }, 'YAML保存')}
      />
    </>
  )
}

function DiagnosticsContent({ activeTab, diagnostics, onCopy, onEditYAML, onOpenLogs }: { activeTab: DiagnosticsTab; diagnostics: K8sDiagnostics; onCopy: (label: string, value: string) => void; onEditYAML: () => void; onOpenLogs: () => void }) {
  if (activeTab === 'events') {
    return <EventsPane events={diagnostics.events || []} />
  }
  if (activeTab === 'yaml') {
    return <CodePane title="YAML" value={diagnostics.yaml} onCopy={() => onCopy('YAML', diagnostics.yaml)} onEdit={onEditYAML} />
  }
  if (activeTab === 'describe') {
    return <CodePane title="Describe" value={diagnostics.describe} onCopy={() => onCopy('Describe', diagnostics.describe)} />
  }
  if (activeTab === 'logs') {
    return (
      <section className="rounded-[16px] border border-border bg-card p-5">
        <h3 className="text-base font-black text-foreground">Pod 日志</h3>
        <p className="mt-2 text-sm font-semibold text-muted-foreground">继续使用现有日志查看器，保持日志筛选和下载能力。</p>
        <button type="button" onClick={onOpenLogs} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90">
          打开日志
        </button>
      </section>
    )
  }
  return <OverviewPane diagnostics={diagnostics} />
}

function OverviewPane({ diagnostics }: { diagnostics: K8sDiagnostics }) {
  return (
    <div className="space-y-4">
      <section className="rounded-[16px] border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <K8sStatusBadge status={diagnostics.status} />
          {diagnostics.age ? <span className="text-sm font-semibold text-muted-foreground">Age {diagnostics.age}</span> : null}
          {diagnostics.node ? <span className="text-sm font-semibold text-muted-foreground">Node {diagnostics.node}</span> : null}
          {diagnostics.ip ? <span className="text-sm font-semibold text-muted-foreground">IP {diagnostics.ip}</span> : null}
        </div>
      </section>

      <KeyValueSection title="摘要" values={diagnostics.summary || {}} />
      <KeyValueSection title="Labels" values={diagnostics.metadata || {}} />

      {diagnostics.containers && diagnostics.containers.length > 0 ? (
        <section className="rounded-[16px] border border-border bg-card p-5">
          <h3 className="text-base font-black text-foreground">容器</h3>
          <div className="mt-3 space-y-2">
            {diagnostics.containers.map((container) => (
              <div key={container.name} className="rounded-xl border border-border bg-surface p-3">
                <p className="font-black text-foreground">{container.name}</p>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">{container.image}</p>
                <p className="mt-1 text-xs font-bold text-muted-foreground">Ready {container.ready ? 'true' : 'false'} · Restarts {container.restart_count}{container.state ? ` · ${container.state}` : ''}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {diagnostics.conditions && diagnostics.conditions.length > 0 ? (
        <section className="rounded-[16px] border border-border bg-card p-5">
          <h3 className="text-base font-black text-foreground">Conditions</h3>
          <div className="mt-3 space-y-2">
            {diagnostics.conditions.map((condition) => (
              <div key={`${condition.type}-${condition.status}`} className="rounded-xl border border-border bg-surface p-3">
                <p className="font-black text-foreground">{condition.type}: {condition.status}</p>
                {condition.reason || condition.message ? <p className="mt-1 text-sm font-semibold text-muted-foreground">{condition.reason}{condition.message ? ` - ${condition.message}` : ''}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function KeyValueSection({ title, values }: { title: string; values: Record<string, string> }) {
  const entries = Object.entries(values)
  if (entries.length === 0) return null
  return (
    <section className="rounded-[16px] border border-border bg-card p-5">
      <h3 className="text-base font-black text-foreground">{title}</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-xl border border-border bg-surface px-3 py-2">
            <p className="text-xs font-black uppercase text-muted-foreground">{key}</p>
            <p className="mt-1 break-all text-sm font-semibold text-foreground">{value || '-'}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function EventsPane({ events }: { events: K8sDiagnostics['events'] }) {
  if (!events || events.length === 0) return <DrawerState text="暂无 Events" />
  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <div key={`${event.reason}-${index}`} className="rounded-[14px] border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-xs font-black ${event.type === 'Warning' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>{event.type || 'Normal'}</span>
            <span className="font-black text-foreground">{event.reason}</span>
            {event.count ? <span className="text-xs font-bold text-muted-foreground">x{event.count}</span> : null}
            {event.age ? <span className="text-xs font-bold text-muted-foreground">{event.age}</span> : null}
          </div>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">{event.message}</p>
        </div>
      ))}
    </div>
  )
}

function CodePane({ title, value, onCopy, onEdit }: { title: string; value: string; onCopy: () => void; onEdit?: () => void }) {
  return (
    <section className="overflow-hidden rounded-[16px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-base font-black text-foreground">{title}</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCopy} disabled={!value} className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-black text-foreground transition hover:bg-muted disabled:opacity-50">
            复制
          </button>
          {onEdit ? (
            <button type="button" onClick={onEdit} disabled={!value} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-black text-primary transition hover:bg-primary/15 disabled:opacity-50">
              <Pencil size={13} aria-hidden="true" />
              编辑
            </button>
          ) : null}
        </div>
      </div>
      <pre className="max-h-[calc(100vh-220px)] overflow-auto bg-slate-950 p-4 text-xs leading-5 text-slate-100"><code>{value || '暂无内容'}</code></pre>
    </section>
  )
}

function DrawerState({ text }: { text: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-border bg-card p-8 text-center">
      <p className="text-sm font-bold text-muted-foreground">{text}</p>
    </div>
  )
}

function ModalShell({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4" onClick={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[16px] border border-border bg-card shadow-2xl">
        <header className="border-b border-border px-5 py-4">
          <h3 className="text-lg font-black text-foreground">{title}</h3>
        </header>
        {children}
      </section>
    </div>
  )
}

function YAMLEditModal({ open, value, dryRunPassed, submitting, onChange, onClose, onDryRun, onSave }: { open: boolean; value: string; dryRunPassed: boolean; submitting: boolean; onChange: (value: string) => void; onClose: () => void; onDryRun: () => void; onSave: () => void }) {
  return (
    <ModalShell open={open} title="编辑 YAML" onClose={onClose}>
      <div className="min-h-0 flex-1 p-5">
        <label htmlFor="k8s-yaml-editor" className="sr-only">YAML 内容</label>
        <textarea
          id="k8s-yaml-editor"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          className="h-[58vh] min-h-[360px] w-full resize-none rounded-lg border border-border bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-100 outline-none transition focus:border-primary"
        />
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 py-4">
        <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-foreground transition hover:bg-muted disabled:opacity-50">取消</button>
        <button type="button" onClick={onDryRun} disabled={submitting || !value.trim()} className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary/15 disabled:opacity-50">
          <CheckCircle2 size={16} aria-hidden="true" />
          {submitting ? '校验中' : 'Dry Run'}
        </button>
        <button type="button" onClick={onSave} disabled={submitting || !dryRunPassed} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
          <Save size={16} aria-hidden="true" />
          {submitting ? '保存中' : '保存'}
        </button>
      </footer>
    </ModalShell>
  )
}

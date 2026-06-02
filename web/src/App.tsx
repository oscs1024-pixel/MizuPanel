import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createInstallCommand, deleteNode, deleteNodePath, getNodeDocker, getNodeFiles, getNodeMetrics, getNodeProcesses, getNodes, getSettings, readNodeFile, rebootNode, startSSHInstall, startSSHUninstall, updateSettings, uploadNodeFile, writeNodeFile } from './api/client'
import { MetricCard } from './components/MetricCard'
import { HistoryPage } from './pages/HistoryPage'
import { NodeDetail } from './pages/NodeDetail'
import { NodeList } from './pages/NodeList'
import { SystemSettingsPage } from './pages/SystemSettingsPage'
import { TerminalPage } from './pages/TerminalPage'
import type { AgentMode, DockerContainer, DockerSnapshotResponse, InstallPlatform, Metric, Node, ProcessSnapshotResponse, RangeOption, SettingsResponse, SSHAuthType, SSHProgressEvent } from './types'

function decodeRouteNodeID(value?: string) {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function nodePath(nodeID: string) {
  return `/nodes/${encodeURIComponent(nodeID)}`
}

type AppRoute =
  | { kind: 'node-terminal', nodeID: string }
  | { kind: 'container-exec', nodeID: string, containerID: string }
  | { kind: 'node-detail', nodeID: string }
  | { kind: 'history' }
  | { kind: 'settings' }
  | { kind: 'dashboard' }

type AppPage = 'hosts' | 'history' | 'settings'

function currentRoute(): AppRoute {
  const terminalMatch = window.location.pathname.match(/^\/nodes\/([^/]+)\/terminal$/)
  if (terminalMatch) return { kind: 'node-terminal', nodeID: decodeRouteNodeID(terminalMatch[1]) ?? terminalMatch[1] }
  const execMatch = window.location.pathname.match(/^\/nodes\/([^/]+)\/containers\/([^/]+)\/exec$/)
  if (execMatch) return { kind: 'container-exec', nodeID: decodeRouteNodeID(execMatch[1]) ?? execMatch[1], containerID: decodeRouteNodeID(execMatch[2]) ?? execMatch[2] }
  const detailMatch = window.location.pathname.match(/^\/nodes\/([^/]+)$/)
  if (detailMatch) return { kind: 'node-detail', nodeID: decodeRouteNodeID(detailMatch[1]) ?? detailMatch[1] }
  if (window.location.pathname === '/history') return { kind: 'history' }
  if (window.location.pathname === '/settings') return { kind: 'settings' }
  return { kind: 'dashboard' }
}

type HostFilter = 'all' | 'online' | 'offline'

const rangeSeconds: Record<RangeOption, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '3d': 259200,
  '7d': 604800
}

const orderedRanges: RangeOption[] = ['1h', '6h', '24h', '3d', '7d']

type SSHProgressEventLog = SSHProgressEvent & { logs: string[] }

function mergeSSHProgressEvent(current: SSHProgressEventLog[], progress: SSHProgressEvent): SSHProgressEventLog[] {
  const index = current.findIndex((event) => event.step === progress.step)
  if (index === -1) {
    return [...current, { ...progress, logs: progress.message ? [progress.message] : [] }]
  }
  const next = [...current]
  const existing = next[index]
  const logs = progress.message && existing.logs[existing.logs.length - 1] !== progress.message
    ? [...existing.logs, progress.message]
    : existing.logs
  next[index] = { ...existing, ...progress, logs }
  return next
}

function largestAllowedRange(seconds: number): RangeOption {
  const allowed = orderedRanges.filter((option) => rangeSeconds[option] <= seconds)
  return allowed.length > 0 ? allowed[allowed.length - 1] : '1h'
}

export default function App() {
  const route = useMemo(() => currentRoute(), [])
  const [page, setPage] = useState<AppPage>(route.kind === 'history' ? 'history' : route.kind === 'settings' ? 'settings' : 'hosts')
  const [nodes, setNodes] = useState<Node[]>([])
  const [selectedNodeID, setSelectedNodeID] = useState<string>()
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [processSnapshot, setProcessSnapshot] = useState<ProcessSnapshotResponse>()
  const [dockerSnapshot, setDockerSnapshot] = useState<DockerSnapshotResponse>()
  const [monitoringLoading, setMonitoringLoading] = useState(false)
  const [range, setRange] = useState<RangeOption>('1h')
  const [error, setError] = useState<string>()
  const [search, setSearch] = useState('')
  const [hostFilter, setHostFilter] = useState<HostFilter>('all')
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform>('linux')
  const [installDockerEnabled, setInstallDockerEnabled] = useState(false)
  const [installTerminalEnabled, setInstallTerminalEnabled] = useState(true)
  const [installMode, setInstallMode] = useState<AgentMode>('normal')
  const [installCommand, setInstallCommand] = useState<string>()
  const [installCommandWarning, setInstallCommandWarning] = useState<string>()
  const [installCommandError, setInstallCommandError] = useState<string>()
  const [installCommandCopied, setInstallCommandCopied] = useState(false)
  const [installToken, setInstallToken] = useState<string>()
  const [installCommandLoading, setInstallCommandLoading] = useState(false)
  const [installCommandOpen, setInstallCommandOpen] = useState(false)
  const [installMethod, setInstallMethod] = useState<'ssh' | 'manual'>('ssh')
  const [sshHost, setSSHHost] = useState('')
  const [sshPort, setSSHPort] = useState(22)
  const [sshAuthType, setSSHAuthType] = useState<SSHAuthType>('password')
  const [sshPassword, setSSHPassword] = useState('')
  const [sshPrivateKey, setSSHPrivateKey] = useState('')
  const [sshPassphrase, setSSHPassphrase] = useState('')
  const [sshNodeID, setSSHNodeID] = useState('')
  const [sshNodeName, setSSHNodeName] = useState('')
  const [sshInstallLoading, setSSHInstallLoading] = useState(false)
  const [sshInstallMessage, setSSHInstallMessage] = useState<string>()
  const [sshInstallError, setSSHInstallError] = useState<string>()
  const [sshInstallEvents, setSSHInstallEvents] = useState<SSHProgressEventLog[]>([])
  const [settings, setSettings] = useState<SettingsResponse>()
  const [settingsRetention, setSettingsRetention] = useState<RangeOption>('6h')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<string>()
  const [settingsError, setSettingsError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const addHostButtonRef = useRef<HTMLButtonElement>(null)
  const installCommandCodeRef = useRef<HTMLElement>(null)
  const installCommandDialogRef = useRef<HTMLElement>(null)
  const installCommandRequestID = useRef(0)

  const loadNodes = useCallback(() => {
    return getNodes()
      .then((response) => {
        setNodes(response.nodes)
        const routeNodeID = route.kind === 'node-detail' || route.kind === 'node-terminal' || route.kind === 'container-exec' ? route.nodeID : undefined
        const routeNodeExists = routeNodeID ? response.nodes.some((node) => node.id === routeNodeID) : false
        setSelectedNodeID((current) => {
          if (current && response.nodes.some((node) => node.id === current)) return current
          return routeNodeExists ? routeNodeID : response.nodes[0]?.id
        })
      })
  }, [route])

  useEffect(() => {
    let cancelled = false
    loadNodes()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '节点加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadNodes])

  useEffect(() => {
    if (page !== 'hosts' || !selectedNodeID) return
    if (window.location.pathname === '/history' || window.location.pathname === '/settings') return
    if (window.location.pathname !== nodePath(selectedNodeID)) {
      window.history.replaceState({}, '', nodePath(selectedNodeID))
    }
  }, [page, selectedNodeID])

  useEffect(() => {
    if (page !== 'history' && page !== 'settings') return
    let cancelled = false
    getSettings()
      .then((response) => {
        if (!cancelled) {
          setSettings(response)
          setSettingsRetention(response.metrics_retention)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setSettingsError(err instanceof Error ? err.message : '系统设置加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [page])

  useEffect(() => {
    if (!settings || rangeSeconds[range] <= settings.metrics_retention_seconds) return
    setRange(largestAllowedRange(settings.metrics_retention_seconds))
  }, [range, settings])

  useEffect(() => {
    if (!selectedNodeID) {
      setMetrics([])
      return
    }
    let cancelled = false
    setMetrics([])
    getNodeMetrics(selectedNodeID, range)
      .then((response) => {
        if (!cancelled) setMetrics(response.metrics)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '指标加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [selectedNodeID, range])

  useEffect(() => {
    if (!selectedNodeID) {
      setProcessSnapshot(undefined)
      setDockerSnapshot(undefined)
      setMonitoringLoading(false)
      return
    }
    let cancelled = false
    setProcessSnapshot(undefined)
    setDockerSnapshot(undefined)
    setMonitoringLoading(true)
    Promise.all([getNodeProcesses(selectedNodeID), getNodeDocker(selectedNodeID)])
      .then(([processes, docker]) => {
        if (!cancelled) {
          setProcessSnapshot(processes)
          setDockerSnapshot(docker)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '监控快照加载失败')
      })
      .finally(() => {
        if (!cancelled) setMonitoringLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedNodeID])

  const onlineNodes = nodes.filter((node) => node.status === 'online').length
  const averages = useMemo(() => {
    const latest = nodes.map((node) => node.latest_metric).filter((metric): metric is Metric => Boolean(metric))
    const average = (key: 'cpu_usage' | 'memory_usage' | 'disk_usage') => latest.length === 0 ? 0 : latest.reduce((sum, metric) => sum + metric[key], 0) / latest.length
    return { cpu: average('cpu_usage'), memory: average('memory_usage'), disk: average('disk_usage') }
  }, [nodes])

  const removeNodeRecord = useCallback((nodeID: string) => {
    return deleteNode(nodeID).then(() => {
      if (selectedNodeID === nodeID) {
        setMetrics([])
        setProcessSnapshot(undefined)
        setDockerSnapshot(undefined)
      }
      return loadNodes()
    })
  }, [loadNodes, selectedNodeID])

  const filteredNodes = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return nodes.filter((node) => {
      if (hostFilter !== 'all' && node.status !== hostFilter) return false
      if (!keyword) return true
      return [node.name, node.hostname, node.ip, node.os, node.arch].some((value) => value.toLowerCase().includes(keyword))
    })
  }, [hostFilter, nodes, search])
  const visibleSelectedNode = useMemo(() => filteredNodes.find((node) => node.id === selectedNodeID), [filteredNodes, selectedNodeID])
  const routeNode = useMemo(() => route.kind === 'node-detail' || route.kind === 'node-terminal' || route.kind === 'container-exec' ? nodes.find((node) => node.id === route.nodeID) : undefined, [nodes, route])
  const routeContainer = useMemo<DockerContainer | undefined>(() => {
    if (route.kind !== 'container-exec') return undefined
    return dockerSnapshot?.containers.find((container) => (container.full_id || container.id) === route.containerID || container.id === route.containerID)
  }, [dockerSnapshot, route])

  useEffect(() => {
    if (page === 'hosts' && filteredNodes.length > 0 && !visibleSelectedNode) {
      setSelectedNodeID(filteredNodes[0].id)
    }
  }, [filteredNodes, page, visibleSelectedNode])

  useEffect(() => {
    if (installCommandOpen) {
      installCommandDialogRef.current?.focus()
    }
  }, [installCommandOpen])

  const requestInstallCommand = (platform: InstallPlatform, enableDocker = installDockerEnabled, enableTerminal = installTerminalEnabled, mode = installMode) => {
    const requestID = installCommandRequestID.current + 1
    installCommandRequestID.current = requestID
    setInstallCommand(undefined)
    setInstallToken(undefined)
    setInstallCommandWarning(undefined)
    setInstallCommandError(undefined)
    setInstallCommandCopied(false)
    setInstallCommandLoading(true)
    const linuxOptions = {
      ...(enableDocker ? { enableDocker: true } : {}),
      ...(enableTerminal ? { enableTerminal: true } : {}),
      mode
    }
    const hasLinuxOptions = platform === 'linux' && Object.keys(linuxOptions).length > 0
    const commandRequest = hasLinuxOptions ? createInstallCommand(platform, linuxOptions) : createInstallCommand(platform)
    return commandRequest
      .then((response) => {
        if (requestID === installCommandRequestID.current) {
          setInstallCommand(response.command)
          setInstallToken(response.install_token)
        }
      })
      .catch((err: unknown) => {
        if (requestID === installCommandRequestID.current) {
          setInstallCommandError(err instanceof Error ? err.message : '安装命令生成失败')
        }
      })
      .finally(() => {
        if (requestID === installCommandRequestID.current) {
          setInstallCommandLoading(false)
        }
      })
  }

  const selectInstallCommand = () => {
    const code = installCommandCodeRef.current
    if (!code) return false
    const range = document.createRange()
    range.selectNodeContents(code)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return true
  }

  const copyInstallCommand = () => {
    if (!installCommand) return
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(installCommand))
      .catch(() => {
        if (!selectInstallCommand()) return false
        return typeof document.execCommand === 'function' && document.execCommand('copy')
      })
      .then((copied) => {
        if (copied === false) {
          setInstallCommandCopied(false)
          setInstallCommandWarning('复制失败，已为你选中命令，请按 Ctrl+C 手动复制。')
          return
        }
        setInstallCommandWarning(undefined)
        setInstallCommandCopied(true)
      })
      .catch(() => {
        selectInstallCommand()
        setInstallCommandCopied(false)
        setInstallCommandWarning('复制失败，已为你选中命令，请按 Ctrl+C 手动复制。')
      })
  }

  const closeInstallCommand = () => {
    installCommandRequestID.current += 1
    setInstallCommand(undefined)
    setInstallToken(undefined)
    setInstallCommandWarning(undefined)
    setInstallCommandError(undefined)
    setInstallCommandCopied(false)
    setInstallCommandLoading(false)
    setSSHHost('')
    setSSHPort(22)
    setSSHAuthType('password')
    setSSHPassword('')
    setSSHPrivateKey('')
    setSSHPassphrase('')
    setSSHNodeID('')
    setSSHNodeName('')
    setSSHInstallLoading(false)
    setSSHInstallMessage(undefined)
    setSSHInstallError(undefined)
    setSSHInstallEvents([])
    setInstallCommandOpen(false)
    addHostButtonRef.current?.focus()
  }

  const handleInstallCommandKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      closeInstallCommand()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = installCommandDialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
      event.preventDefault()
      first.focus()
    }
  }

  const hostFilterButtonClass = (filter: HostFilter, activeClass: string, inactiveClass: string) => (
    `min-h-10 cursor-pointer rounded-2xl px-4 text-sm font-black transition focus:outline-none focus:ring-4 ${hostFilter === filter ? activeClass : inactiveClass}`
  )

  const showInstallCommand = () => {
    setInstallCommandOpen(true)
    setInstallMethod('ssh')
  }

  const selectInstallMethod = (method: 'ssh' | 'manual') => {
    setInstallMethod(method)
    if (method === 'manual' && !installCommand) {
      setInstallPlatform('linux')
      requestInstallCommand('linux')
    }
  }

  const selectInstallPlatform = (platform: InstallPlatform) => {
    if (platform === installPlatform) return
    setInstallPlatform(platform)
    requestInstallCommand(platform)
  }

  const toggleInstallDocker = (enabled: boolean) => {
    setInstallDockerEnabled(enabled)
    if (installMethod === 'manual' && installPlatform === 'linux') {
      requestInstallCommand('linux', enabled, installTerminalEnabled, installMode)
    }
  }

  const toggleInstallTerminal = (enabled: boolean) => {
    setInstallTerminalEnabled(enabled)
    if (installMethod === 'manual' && installPlatform === 'linux') {
      requestInstallCommand('linux', installDockerEnabled, enabled, installMode)
    }
  }

  const selectInstallMode = (mode: AgentMode) => {
    setInstallMode(mode)
    if (installMethod === 'manual' && installPlatform === 'linux') {
      requestInstallCommand('linux', installDockerEnabled, installTerminalEnabled, mode)
    }
  }

  const subscribeSSHInstallProgress = (jobID: string) => {
    const source = new EventSource(`/api/install/ssh/${encodeURIComponent(jobID)}/events`)
    source.onmessage = (event) => {
      const progress = JSON.parse(event.data) as SSHProgressEvent
      setSSHInstallEvents((current) => mergeSSHProgressEvent(current, progress))
      if (progress.done) source.close()
    }
    source.onerror = () => source.close()
  }

  const startSSHInstallJob = () => {
    setSSHInstallLoading(true)
    setSSHInstallMessage(undefined)
    setSSHInstallError(undefined)
    setSSHInstallEvents([])
    startSSHInstall({
      host: sshHost.trim(),
      port: sshPort || 22,
      username: 'root',
      auth_type: sshAuthType,
      ...(sshAuthType === 'password' ? { password: sshPassword } : { private_key: sshPrivateKey, ...(sshPassphrase ? { passphrase: sshPassphrase } : {}) }),
      node_id: sshNodeID.trim(),
      name: sshNodeName.trim(),
      enable_terminal: installTerminalEnabled,
      enable_docker: installDockerEnabled,
      mode: installMode
    })
      .then((response) => {
        setSSHInstallMessage(`SSH 安装任务已创建：${response.job_id}`)
        subscribeSSHInstallProgress(response.job_id)
      })
      .catch((err: unknown) => setSSHInstallError(err instanceof Error ? err.message : 'SSH 安装任务创建失败'))
      .finally(() => setSSHInstallLoading(false))
  }

  const openPage = (nextPage: AppPage) => {
    setPage(nextPage)
    const path = nextPage === 'history'
      ? '/history'
      : nextPage === 'settings'
        ? '/settings'
        : selectedNodeID ? nodePath(selectedNodeID) : '/'
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path)
    }
  }

  const saveSettings = () => {
    setSettingsSaving(true)
    setSettingsMessage(undefined)
    setSettingsError(undefined)
    updateSettings({ metrics_retention: settingsRetention })
      .then((response) => {
        setSettings(response)
        setSettingsRetention(response.metrics_retention)
        setSettingsMessage('设置已保存，新的保留时间会立即用于历史查询和后续清理。')
      })
      .catch((err: unknown) => setSettingsError(err instanceof Error ? err.message : '系统设置保存失败'))
      .finally(() => setSettingsSaving(false))
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f2f4f7] px-4 text-slate-950">
        <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-5 text-sm font-black text-slate-500 shadow-glass">正在加载节点...</div>
      </main>
    )
  }

  if (route.kind === 'node-terminal') {
    return <TerminalPage kind="node" nodeID={route.nodeID} node={routeNode} />
  }

  if (route.kind === 'container-exec') {
    return <TerminalPage kind="container" nodeID={route.nodeID} node={routeNode} containerID={route.containerID} container={routeContainer} />
  }

  const installCommandDialog = installCommandOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-3 py-6">
      <section
        id="agent-install-command"
        ref={installCommandDialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="添加主机"
        aria-live="polite"
        tabIndex={-1}
        onKeyDown={handleInstallCommandKeyDown}
        className="max-h-[calc(100vh-3rem)] w-full max-w-4xl overflow-x-hidden overflow-y-auto rounded-[28px] border border-slate-200 bg-white text-left shadow-2xl outline-none"
      >
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-950">添加主机</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">通过 SSH 自动安装，或复制手动命令到目标机器执行；SSH 凭据只本次使用，不会保存。</p>
            </div>
            <button
              type="button"
              aria-label="关闭添加主机"
              onClick={closeInstallCommand}
              className="min-h-10 shrink-0 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-500 transition hover:border-emerald-300 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-emerald-100"
            >
              关闭
            </button>
          </div>
          <div className="mt-3 flex w-fit rounded-2xl border border-slate-200 bg-white p-1 shadow-inner" aria-label="选择添加主机方式">
            {([
              ['ssh', 'SSH 自动安装'],
              ['manual', '手动命令安装']
            ] as const).map(([method, label]) => (
              <button
                key={method}
                type="button"
                aria-pressed={installMethod === method}
                onClick={() => selectInstallMethod(method)}
                className={`min-h-9 cursor-pointer rounded-xl px-4 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${installMethod === method ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {installMethod === 'ssh' ? (
            <div className="mt-3 grid gap-3 rounded-[24px] border border-slate-200 bg-white p-3 lg:grid-cols-2">
              <label className="text-xs font-black text-slate-950">
                SSH Host
                <input aria-label="SSH Host" value={sshHost} onChange={(event) => setSSHHost(event.target.value)} placeholder="192.168.1.10" className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
              </label>
              <label className="text-xs font-black text-slate-950">
                SSH 端口
                <input aria-label="SSH 端口" type="number" value={sshPort} onChange={(event) => setSSHPort(Number(event.target.value) || 22)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
              </label>
              <label className="text-xs font-black text-slate-950">
                SSH 用户
                <input aria-label="SSH 用户" value="root" readOnly className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-slate-100 px-3 text-sm font-black text-slate-500" />
              </label>
              <label className="text-xs font-black text-slate-950">
                认证方式
                <select aria-label="SSH 认证方式" value={sshAuthType} onChange={(event) => setSSHAuthType(event.target.value as SSHAuthType)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100">
                  <option value="password">密码</option>
                  <option value="private_key">私钥</option>
                </select>
              </label>
              {sshAuthType === 'password' ? (
                <label className="text-xs font-black text-slate-950 lg:col-span-2">
                  SSH 密码
                  <input aria-label="SSH 密码" type="password" value={sshPassword} onChange={(event) => setSSHPassword(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                </label>
              ) : (
                <>
                  <label className="text-xs font-black text-slate-950 lg:col-span-2">
                    SSH 私钥
                    <textarea aria-label="SSH 私钥" value={sshPrivateKey} onChange={(event) => setSSHPrivateKey(event.target.value)} rows={4} className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-950 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                  </label>
                  <label className="text-xs font-black text-slate-950 lg:col-span-2">
                    私钥 Passphrase（可选）
                    <input aria-label="私钥 Passphrase" type="password" value={sshPassphrase} onChange={(event) => setSSHPassphrase(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                  </label>
                </>
              )}
              <label className="text-xs font-black text-slate-950">
                节点 ID
                <input aria-label="节点 ID" value={sshNodeID} onChange={(event) => setSSHNodeID(event.target.value)} placeholder="node-1" className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
              </label>
              <label className="text-xs font-black text-slate-950">
                节点名称
                <input aria-label="节点名称" value={sshNodeName} onChange={(event) => setSSHNodeName(event.target.value)} placeholder="Oracle SG" className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
              </label>
              <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-inner">
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-start gap-3 text-xs font-bold leading-5 text-slate-500">
                    <input
                      type="checkbox"
                      aria-label="启用节点终端"
                      checked={installTerminalEnabled}
                      onChange={(event) => toggleInstallTerminal(event.target.checked)}
                      className="mt-1 h-4 w-4 cursor-pointer rounded border-slate-200 text-emerald-600 focus:ring-emerald-100"
                    />
                    <span>
                      <span className="block font-black text-slate-950">启用节点终端</span>
                      <span className="block text-slate-500">默认开启；启用后可在节点详情打开浏览器终端。</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 text-xs font-bold leading-5 text-slate-500">
                    <input
                      type="checkbox"
                      aria-label="启用 Docker 容器监控"
                      checked={installDockerEnabled}
                      onChange={(event) => toggleInstallDocker(event.target.checked)}
                      className="mt-1 h-4 w-4 cursor-pointer rounded border-slate-200 text-emerald-600 focus:ring-emerald-100"
                    />
                    <span>
                      <span className="block font-black text-slate-950">启用 Docker 容器监控</span>
                      <span className="block text-slate-500">默认关闭；启用后会授予 Agent 访问 Docker socket 的权限。</span>
                    </span>
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
                    <p className="mb-2 text-xs font-black text-slate-950">Agent 运行模式</p>
                    <div className="flex flex-wrap gap-2">
                      {([
                        ['normal', '普通模式', '以 mizupanel-agent 用户运行'],
                        ['ops', '运维模式', '以 root 用户运行']
                      ] as const).map(([mode, label, description]) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={installMode === mode}
                          onClick={() => selectInstallMode(mode)}
                          className={`min-h-10 cursor-pointer rounded-2xl px-3 text-left text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${installMode === mode ? 'bg-slate-950 text-white' : 'bg-white text-slate-500 hover:text-slate-950'}`}
                        >
                          <span className="block">{label}</span>
                          <span className="block font-semibold opacity-75">{description}</span>
                        </button>
                      ))}
                    </div>
                    {installMode === 'ops' ? <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-red-700">运维模式会以 root 用户运行 Agent，可执行终端、文件编辑和重启等高权限操作。</p> : null}
                  </div>
                </div>
              </div>
              <div className="lg:col-span-2">
                <button type="button" onClick={startSSHInstallJob} disabled={sshInstallLoading} className="min-h-11 cursor-pointer rounded-2xl bg-emerald-500 px-4 text-xs font-black text-white shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
                  {sshInstallLoading ? '正在创建 SSH 安装任务...' : '开始 SSH 安装'}
                </button>
                {sshInstallMessage ? <p className="mt-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">{sshInstallMessage}</p> : null}
                {sshInstallError ? <p className="mt-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700">{sshInstallError}</p> : null}
              </div>
              {sshInstallEvents.length > 0 ? (
                <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-inner">
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">安装进度</p>
                  <ol className="space-y-2">
                    {sshInstallEvents.map((event) => (
                      <li key={event.step} className="flex items-start gap-3 rounded-2xl bg-slate-50 px-3 py-2">
                        <span className={`mt-0.5 h-3 w-3 rounded-full ${event.status === 'success' ? 'bg-emerald-500' : event.status === 'failed' ? 'bg-red-600' : event.status === 'running' ? 'bg-sky-500' : 'bg-slate-400'}`} />
                        <span className="min-w-0">
                          <span className="block text-xs font-black text-slate-950">{event.label}</span>
                          <span className="block text-xs font-black text-slate-500">{event.status === 'success' ? '成功' : event.status === 'failed' ? '失败' : event.status === 'running' ? '进行中' : '待执行'}</span>
                          {event.logs.length > 0 ? (
                            <span className="mt-1 block space-y-1">
                              {event.logs.map((log, index) => <span key={`${event.step}-${index}`} className="block break-words text-xs font-semibold leading-5 text-slate-500">{log}</span>)}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {sshInstallEvents.some((event) => event.done) ? (
                    <button type="button" onClick={closeInstallCommand} className="mt-3 min-h-10 cursor-pointer rounded-2xl bg-emerald-500 px-4 text-xs font-black text-white shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-emerald-100">
                      {sshInstallEvents.some((event) => event.done && event.status === 'success') ? '完成并关闭' : '关闭'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {installMethod === 'manual' ? (
            <>
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">简化状态</p>
                <ol className="mt-3 space-y-2">
                  <li className="flex items-start gap-3 rounded-2xl bg-white px-3 py-2">
                    <span className="mt-0.5 h-3 w-3 rounded-full bg-emerald-500" />
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-slate-950">已生成一次性 install_token</span>
                      <span className="block text-xs font-bold text-slate-500">{installToken || '等待生成'}</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-3 rounded-2xl bg-white px-3 py-2">
                    <span className="mt-0.5 h-3 w-3 rounded-full bg-sky-500" />
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-slate-950">等待在目标机器执行命令</span>
                      <span className="block text-xs font-bold text-slate-500">复制命令到目标 Linux 机器后执行即可。</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-3 rounded-2xl bg-white px-3 py-2">
                    <span className="mt-0.5 h-3 w-3 rounded-full bg-slate-400" />
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-slate-950">等待 Agent 首次注册</span>
                      <span className="block text-xs font-bold text-slate-500">安装完成后，Agent 会自动连接到 MizuPanel。</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-3 rounded-2xl bg-white px-3 py-2">
                    <span className="mt-0.5 h-3 w-3 rounded-full bg-slate-950" />
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-slate-950">Agent 已连接，安装成功</span>
                      <span className="block text-xs font-bold text-slate-500">上线后就可以在主机列表看到节点。</span>
                    </span>
                  </li>
                </ol>
                <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">超时未连接时，请检查 server_url、防火墙或 Agent 日志。</p>
              </div>

              <div className="mt-3 flex w-fit rounded-2xl border border-slate-200 bg-white p-1 shadow-inner" aria-label="选择 Agent 安装系统">
                {(['linux', 'windows'] as const).map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    aria-pressed={installPlatform === platform}
                    onClick={() => selectInstallPlatform(platform)}
                    className={`min-h-9 cursor-pointer rounded-xl px-4 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${installPlatform === platform ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'}`}
                  >
                    {platform === 'linux' ? 'Linux' : 'Windows'}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-inner">
                {installPlatform === 'linux' ? (
                  <div className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-3 text-xs font-bold leading-5 text-slate-500">
                      <input
                        type="checkbox"
                        aria-label="启用 Docker 容器监控"
                        checked={installDockerEnabled}
                        onChange={(event) => toggleInstallDocker(event.target.checked)}
                        className="mt-1 h-4 w-4 cursor-pointer rounded border-slate-200 text-emerald-600 focus:ring-emerald-100"
                      />
                      <span>
                        <span className="block font-black text-slate-950">启用 Docker 容器监控</span>
                        <span className="block text-slate-500">启用后会授予 Agent 访问 Docker socket 的权限，docker 组权限接近 root。</span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-3 text-xs font-bold leading-5 text-slate-500">
                      <input
                        type="checkbox"
                        aria-label="启用节点终端"
                        checked={installTerminalEnabled}
                        onChange={(event) => toggleInstallTerminal(event.target.checked)}
                        className="mt-1 h-4 w-4 cursor-pointer rounded border-slate-200 text-emerald-600 focus:ring-emerald-100"
                      />
                      <span>
                        <span className="block font-black text-slate-950">启用节点终端</span>
                        <span className="block text-slate-500">启用后可在节点详情打开浏览器终端，命令以 Agent 当前运行用户权限运行。</span>
                      </span>
                    </label>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
                      <p className="mb-2 text-xs font-black text-slate-950">Agent 运行模式</p>
                      <div className="flex flex-wrap gap-2">
                        {([
                          ['normal', '普通模式', '以 mizupanel-agent 用户运行'],
                          ['ops', '运维模式', '以 root 用户运行']
                        ] as const).map(([mode, label, description]) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={installMode === mode}
                            onClick={() => selectInstallMode(mode)}
                            className={`min-h-10 cursor-pointer rounded-2xl px-3 text-left text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${installMode === mode ? 'bg-slate-950 text-white' : 'bg-white text-slate-500 hover:text-slate-950'}`}
                          >
                            <span className="block">{label}</span>
                            <span className="block font-semibold opacity-75">{description}</span>
                          </button>
                        ))}
                      </div>
                      {installMode === 'ops' ? <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-red-700">运维模式会以 root 用户运行 Agent，可执行终端、文件编辑和重启等高权限操作。</p> : null}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-bold leading-5 text-slate-500">Windows 暂不支持 Docker 监控和节点终端安装配置。</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-label={installCommandCopied ? '已复制' : '复制安装命令'}
                  onClick={copyInstallCommand}
                  disabled={!installCommand}
                  className="min-h-10 cursor-pointer rounded-2xl bg-emerald-500 px-4 text-xs font-black text-white shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {installCommandCopied ? '已复制' : '复制'}
                </button>
                <button
                  type="button"
                  aria-label="关闭安装命令"
                  onClick={closeInstallCommand}
                  className="min-h-10 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-500 transition hover:border-emerald-300 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                >
                  关闭
                </button>
              </div>

              {installCommandLoading ? (
                <div className="bg-slate-950 px-4 py-4 text-xs font-bold leading-6 text-slate-100">正在生成安装命令...</div>
              ) : installCommand ? (
                <pre className="overflow-x-auto bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100"><code ref={installCommandCodeRef}>{installCommand}</code></pre>
              ) : (
                <div className="border-t border-red-200 bg-red-50 px-4 py-4 text-xs font-bold leading-5 text-red-700">{installCommandError || '安装命令暂不可用，请重试。'}</div>
              )}
              {installCommandWarning ? (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
                  {installCommandWarning}
                </div>
              ) : null}
              {installPlatform === 'windows' ? (
                <div className="border-t border-sky-200 bg-sky-50 px-4 py-3 text-xs font-bold leading-5 text-sky-700">
                  Windows 命令需要在管理员 PowerShell 中执行。
                </div>
              ) : null}
              <div className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
                token 来源：点击添加主机时，Server 会自动生成一次性 install_token。
              </div>
            </>
          ) : null}
        </div>
      </div>
      </section>
    </div>
  ) : null

  return (
    <main className="min-h-screen bg-[#f2f4f7] text-slate-950">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_18%_8%,rgba(59,130,246,0.16),transparent_30%),radial-gradient(circle_at_82%_10%,rgba(16,185,129,0.14),transparent_26%)]" />
      <div className="relative mx-auto flex w-full max-w-[1380px] flex-col gap-4 px-3 py-3 sm:px-5 lg:px-6">
        <header className="rounded-[28px] border border-white/80 bg-white/90 px-4 py-3 shadow-glass backdrop-blur-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-lg font-black text-white shadow-lg shadow-slate-300/60">M</div>
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.26em] text-slate-400">自托管控制台</p>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 className="font-display text-2xl font-black tracking-tight text-slate-950">MizuPanel</h1>
                  <p className="text-sm font-medium text-slate-500">轻量级自托管服务器监控面板</p>
                </div>
              </div>
            </div>

            <nav className="flex flex-wrap items-center gap-2" aria-label="主导航">
              {([
                ['hosts', '主机列表'],
                ['history', '历史记录'],
                ['settings', '系统设置']
              ] as const).map(([targetPage, item]) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => openPage(targetPage)}
                  className={`min-h-11 cursor-pointer rounded-2xl px-4 text-sm font-extrabold transition focus:outline-none focus:ring-4 focus:ring-blue-200 ${
                    page === targetPage ? 'bg-slate-950 text-white shadow-lg shadow-slate-300/70' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950'
                  }`}
                >
                  {item}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-semibold text-red-700 shadow-sm">{error}</div> : null}

        {installCommandDialog}

        {page === 'history' ? (
          <HistoryPage nodes={nodes} selectedNodeID={selectedNodeID} metrics={metrics} range={range} settings={settings} onSelectNode={setSelectedNodeID} onRangeChange={setRange} />
        ) : page === 'settings' ? (
          <SystemSettingsPage settings={settings} selectedRetention={settingsRetention} saving={settingsSaving} message={settingsMessage} error={settingsError} onSelectRetention={setSettingsRetention} onSave={saveSettings} />
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="节点总数" value={String(nodes.length)} detail="已注册 Agent" />
              <MetricCard label="在线节点" value={String(onlineNodes)} tone="green" detail={`${nodes.length - onlineNodes} 个离线`} />
              <MetricCard label="平均 CPU" value={`${averages.cpu.toFixed(1)}%`} tone="amber" detail="最新采样" />
              <MetricCard label="平均内存" value={`${averages.memory.toFixed(1)}%`} tone="slate" detail="最新采样" />
            </section>

            {nodes.length === 0 ? (
              <section className="rounded-[30px] border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-glass">
                <p className="font-display text-3xl font-black text-slate-950">暂无节点接入</p>
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500">在目标服务器执行 Agent 安装命令后，节点会自动出现在这里。</p>
                <button
                  ref={addHostButtonRef}
                  type="button"
                  onClick={showInstallCommand}
                  aria-expanded={installCommandOpen}
                  aria-controls="agent-install-command"
                  className="mt-6 min-h-11 cursor-pointer rounded-2xl bg-slate-950 px-5 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-100"
                >
                  安装目标主机 Agent 进行采集
                </button>
              </section>
            ) : (
              <section className="rounded-[32px] border border-white/80 bg-white/85 p-3 shadow-glass backdrop-blur-xl">
                <div className="mb-3 flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-slate-50/90 p-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="主机筛选与操作">
                    <button
                      type="button"
                      aria-pressed={hostFilter === 'all'}
                      onClick={() => setHostFilter('all')}
                      className={hostFilterButtonClass('all', 'bg-slate-950 text-white shadow-lg shadow-slate-300/70 focus:ring-blue-200', 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950 focus:ring-slate-200')}
                    >
                      全部 {nodes.length}
                    </button>
                    <button
                      type="button"
                      aria-pressed={hostFilter === 'online'}
                      onClick={() => setHostFilter('online')}
                      className={hostFilterButtonClass('online', 'border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-lg shadow-emerald-100/70 focus:ring-emerald-100', 'border border-emerald-200 bg-white text-emerald-600 hover:bg-emerald-50 focus:ring-emerald-100')}
                    >
                      在线 {onlineNodes}
                    </button>
                    <button
                      type="button"
                      aria-pressed={hostFilter === 'offline'}
                      onClick={() => setHostFilter('offline')}
                      className={hostFilterButtonClass('offline', 'border border-slate-300 bg-slate-200 text-slate-800 shadow-lg shadow-slate-200/70 focus:ring-slate-200', 'border border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-950 focus:ring-slate-200')}
                    >
                      离线 {nodes.length - onlineNodes}
                    </button>
                    <button
                      ref={addHostButtonRef}
                      type="button"
                      onClick={showInstallCommand}
                      aria-expanded={installCommandOpen}
                      aria-controls="agent-install-command"
                      className="min-h-10 cursor-pointer rounded-2xl bg-blue-600 px-4 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200"
                    >
                      添加主机
                    </button>
                  </div>
                  <div className="relative w-full lg:max-w-sm">
                    <label htmlFor="host-search" className="sr-only">搜索主机</label>
                    <input
                      id="host-search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="搜索主机..."
                      className="min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-[0.76fr_1.24fr]">
                  {filteredNodes.length > 0 ? (
                    <NodeList nodes={filteredNodes} selectedNodeID={selectedNodeID} onSelectNode={(node) => setSelectedNodeID(node.id)} />
                  ) : (
                    <section className="rounded-[26px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                      <p className="font-display text-2xl font-black text-slate-950">未找到匹配主机</p>
                      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">请调整在线状态筛选或搜索关键词。</p>
                    </section>
                  )}
                  <NodeDetail node={visibleSelectedNode} metrics={metrics} processSnapshot={processSnapshot} dockerSnapshot={dockerSnapshot} monitoringLoading={monitoringLoading} range={range} onRangeChange={setRange} onLoadFiles={getNodeFiles} onReadFile={readNodeFile} onWriteFile={writeNodeFile} onUploadFile={uploadNodeFile} onDeletePath={deleteNodePath} onRebootNode={rebootNode} onDeleteNode={removeNodeRecord} onSSHUninstall={startSSHUninstall} />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}

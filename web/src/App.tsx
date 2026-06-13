import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createInstallCommand, deleteNodePath, getAgentLogs, getAgentStatus, getAuthSession, getNodeDocker, getNodeFiles, getNodeMetrics, getNodeProcesses, getNodes, getSettings, login, logout, readNodeFile, rebootNode, restartAgent, setUnauthorizedHandler, startSSHInstall, startSSHUninstall, updateSettings, uploadNodeFile, writeNodeFile } from './api/client'
import { MetricCard } from './components/MetricCard'
import { formatBytes, formatPercent, formatSpeed } from './lib/format'
import { HistoryPage } from './pages/HistoryPage'
import { NodeDetail } from './pages/NodeDetail'
import { NodeList } from './pages/NodeList'
import { SystemSettingsPage } from './pages/SystemSettingsPage'
import { TerminalPage } from './pages/TerminalPage'
import type { DockerContainer, DockerSnapshotResponse, InstallPlatform, Metric, Node, ProcessSnapshotResponse, RangeOption, SettingsResponse, SSHAuthType, SSHProgressEvent } from './types'

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
  | { kind: 'overview' }
  | { kind: 'history' }
  | { kind: 'settings' }
  | { kind: 'logs' }
  | { kind: 'dashboard' }

type AppPage = 'overview' | 'hosts' | 'history' | 'settings' | 'logs'
type ThemeMode = 'light' | 'dark'

function currentRoute(): AppRoute {
  const terminalMatch = window.location.pathname.match(/^\/nodes\/([^/]+)\/terminal$/)
  if (terminalMatch) return { kind: 'node-terminal', nodeID: decodeRouteNodeID(terminalMatch[1]) ?? terminalMatch[1] }
  const execMatch = window.location.pathname.match(/^\/nodes\/([^/]+)\/containers\/([^/]+)\/exec$/)
  if (execMatch) return { kind: 'container-exec', nodeID: decodeRouteNodeID(execMatch[1]) ?? execMatch[1], containerID: decodeRouteNodeID(execMatch[2]) ?? execMatch[2] }
  const detailMatch = window.location.pathname.match(/^\/nodes\/([^/]+)$/)
  if (detailMatch) return { kind: 'node-detail', nodeID: decodeRouteNodeID(detailMatch[1]) ?? detailMatch[1] }
  if (window.location.pathname === '/history') return { kind: 'history' }
  if (window.location.pathname === '/settings') return { kind: 'settings' }
  if (window.location.pathname === '/overview') return { kind: 'overview' }
  if (window.location.pathname === '/logs') return { kind: 'logs' }
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

function storedTheme(): ThemeMode {
  const value = window.localStorage.getItem('mizupanel-theme')
  return value === 'dark' ? 'dark' : 'light'
}

function storedSidebarCollapsed() {
  return window.localStorage.getItem('mizupanel-sidebar-collapsed') === 'true'
}

const pageCopy: Record<AppPage, { title: string, description: string }> = {
  overview: { title: '概览', description: '用现有节点和指标数据汇总当前面板状态。' },
  hosts: { title: '主机列表', description: '查看节点状态、指标、文件和节点级操作。' },
  history: { title: '历史记录', description: '按节点和时间范围查看历史指标。' },
  settings: { title: '系统设置', description: '调整 MizuPanel 的全局运行参数。' },
  logs: { title: '日志', description: '日志接口接入前仅提供控制台空状态壳。' }
}

const navItems: Array<{ page: AppPage, label: string, icon: 'overview' | 'hosts' | 'history' | 'settings' | 'logs' }> = [
  { page: 'overview', label: '概览', icon: 'overview' },
  { page: 'hosts', label: '主机列表', icon: 'hosts' },
  { page: 'history', label: '历史记录', icon: 'history' },
  { page: 'settings', label: '系统设置', icon: 'settings' },
  { page: 'logs', label: '日志', icon: 'logs' }
]

export default function App() {
  const route = useMemo(() => currentRoute(), [])
  const [page, setPage] = useState<AppPage>(route.kind === 'history' ? 'history' : route.kind === 'settings' ? 'settings' : route.kind === 'logs' ? 'logs' : route.kind === 'overview' ? 'overview' : 'hosts')
  const [theme, setTheme] = useState<ThemeMode>(() => storedTheme())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => storedSidebarCollapsed())
  const [authEnabled, setAuthEnabled] = useState(false)
  const [authenticated, setAuthenticated] = useState(false)
  const [currentUsername, setCurrentUsername] = useState('')
  const [loginUsername, setLoginUsername] = useState('admin')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string>()
  const [loginLoading, setLoginLoading] = useState(false)
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

  useEffect(() => {
    const dark = theme === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('mizupanel-theme', theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('mizupanel-sidebar-collapsed', sidebarCollapsed ? 'true' : 'false')
  }, [sidebarCollapsed])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthenticated(false)
      setCurrentUsername('')
      setError('登录已过期，请重新登录')
    })
  }, [])

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
    getAuthSession()
      .then((response) => {
        if (cancelled) return
        setAuthEnabled(response.auth_enabled)
        setAuthenticated(response.authenticated)
        setCurrentUsername(response.username)
        if (!response.auth_enabled || response.authenticated) {
          return loadNodes()
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '认证会话检查失败')
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
    if (window.location.pathname === '/history' || window.location.pathname === '/settings' || window.location.pathname === '/overview' || window.location.pathname === '/logs') return
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

  const filteredNodes = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return nodes.filter((node) => {
      if (hostFilter !== 'all' && node.status !== hostFilter) return false
      if (!keyword) return true
      return [node.name, node.hostname, node.ip, node.os, node.arch].some((value) => value.toLowerCase().includes(keyword))
    })
  }, [hostFilter, nodes, search])
  const visibleSelectedNode = useMemo(() => filteredNodes.find((node) => node.id === selectedNodeID), [filteredNodes, selectedNodeID])
  const selectedMetrics = useMemo(() => selectedNodeID ? metrics.filter((metric) => metric.node_id === selectedNodeID) : [], [metrics, selectedNodeID])
  const selectedProcessSnapshot = processSnapshot?.node_id === selectedNodeID ? processSnapshot : undefined
  const selectedDockerSnapshot = dockerSnapshot?.node_id === selectedNodeID ? dockerSnapshot : undefined
  const routeNode = useMemo(() => route.kind === 'node-detail' || route.kind === 'node-terminal' || route.kind === 'container-exec' ? nodes.find((node) => node.id === route.nodeID) : undefined, [nodes, route])
  const routeContainer = useMemo<DockerContainer | undefined>(() => {
    if (route.kind !== 'container-exec') return undefined
    return selectedDockerSnapshot?.containers.find((container) => (container.full_id || container.id) === route.containerID || container.id === route.containerID)
  }, [route, selectedDockerSnapshot])

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

  const requestInstallCommand = (platform: InstallPlatform) => {
    const requestID = installCommandRequestID.current + 1
    installCommandRequestID.current = requestID
    setInstallCommand(undefined)
    setInstallToken(undefined)
    setInstallCommandWarning(undefined)
    setInstallCommandError(undefined)
    setInstallCommandCopied(false)
    setInstallCommandLoading(true)
    return createInstallCommand(platform)
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
      enable_terminal: true,
      enable_docker: true,
      mode: 'ops'
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
    const path = nextPage === 'overview'
      ? '/overview'
      : nextPage === 'history'
      ? '/history'
      : nextPage === 'settings'
        ? '/settings'
        : nextPage === 'logs'
          ? '/logs'
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

  const handleLogin = () => {
    setLoginLoading(true)
    setLoginError(undefined)
    login(loginUsername, loginPassword)
      .then((response) => {
        setAuthenticated(response.authenticated)
        setCurrentUsername(response.username)
        setLoginPassword('')
        return loadNodes()
      })
      .catch((err: unknown) => setLoginError(err instanceof Error ? err.message : '登录失败'))
      .finally(() => setLoginLoading(false))
  }

  const handleLogout = () => {
    logout()
      .then(() => {
        setAuthenticated(false)
        setCurrentUsername('')
        setNodes([])
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '退出登录失败'))
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="rounded-[28px] border border-border bg-card px-6 py-5 text-sm font-black text-muted-foreground shadow-glass">正在加载节点...</div>
      </main>
    )
  }

  if (authEnabled && !authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="登录 MizuPanel"
          className="w-full max-w-md rounded-[28px] border border-border bg-card p-6 shadow-glass"
        >
          <h1 className="text-2xl font-black text-foreground">登录 MizuPanel</h1>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">请使用管理员账号登录以继续。</p>
          <div className="mt-6 space-y-4">
            <label className="block text-sm font-black text-foreground">
              用户名
              <input
                aria-label="用户名"
                type="text"
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
              />
            </label>
            <label className="block text-sm font-black text-foreground">
              密码
              <input
                aria-label="密码"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleLogin()}
                className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20"
              />
            </label>
            {error ? (
              <div className="rounded-2xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm font-black text-warning">
                {error}
              </div>
            ) : null}
            {loginError ? (
              <div className="rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-black text-danger">
                {loginError}
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleLogin}
              disabled={loginLoading}
              className="min-h-11 w-full cursor-pointer rounded-2xl bg-primary px-4 text-sm font-black text-primary-foreground shadow-sm transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loginLoading ? '登录中...' : '登录'}
            </button>
          </div>
        </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-code/35 px-3 py-6">
      <section
        id="agent-install-command"
        ref={installCommandDialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="添加主机"
        aria-live="polite"
        tabIndex={-1}
        onKeyDown={handleInstallCommandKeyDown}
        className="max-h-[calc(100vh-3rem)] w-full max-w-4xl overflow-x-hidden overflow-y-auto rounded-[28px] border border-border bg-card text-left shadow-2xl outline-none"
      >
      <div className="flex flex-col gap-3 border-b border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-foreground">添加主机</p>
              <p className="mt-1 text-xs font-semibold text-muted-foreground">通过 SSH 自动安装，或复制手动命令到目标机器执行；SSH 凭据只本次使用，不会保存。</p>
            </div>
            <button
              type="button"
              aria-label="关闭添加主机"
              onClick={closeInstallCommand}
              className="min-h-10 shrink-0 cursor-pointer rounded-2xl border border-border bg-card px-4 text-xs font-black text-muted-foreground transition hover:border-success/50 hover:text-foreground focus:outline-none focus:ring-4 focus:ring-primary/20"
            >
              关闭
            </button>
          </div>
          <div className="mt-3 flex w-fit rounded-2xl border border-border bg-card p-1 shadow-inner" aria-label="选择添加主机方式">
            {([
              ['ssh', 'SSH 自动安装'],
              ['manual', '手动命令安装']
            ] as const).map(([method, label]) => (
              <button
                key={method}
                type="button"
                aria-pressed={installMethod === method}
                onClick={() => selectInstallMethod(method)}
                className={`min-h-9 cursor-pointer rounded-xl px-4 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${installMethod === method ? 'bg-code text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {installMethod === 'ssh' ? (
            <div className="mt-3 grid gap-3 rounded-[24px] border border-border bg-card p-3 lg:grid-cols-2">
              <label className="text-xs font-black text-foreground">
                SSH Host
                <input aria-label="SSH Host" value={sshHost} onChange={(event) => setSSHHost(event.target.value)} placeholder="192.168.1.10" className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20" />
              </label>
              <label className="text-xs font-black text-foreground">
                SSH 端口
                <input aria-label="SSH 端口" type="number" value={sshPort} onChange={(event) => setSSHPort(Number(event.target.value) || 22)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20" />
              </label>
              <label className="text-xs font-black text-foreground">
                SSH 用户
                <input aria-label="SSH 用户" value="root" readOnly className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-muted px-3 text-sm font-black text-muted-foreground" />
              </label>
              <label className="text-xs font-black text-foreground">
                认证方式
                <select aria-label="SSH 认证方式" value={sshAuthType} onChange={(event) => setSSHAuthType(event.target.value as SSHAuthType)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20">
                  <option value="password">密码</option>
                  <option value="private_key">私钥</option>
                </select>
              </label>
              {sshAuthType === 'password' ? (
                <label className="text-xs font-black text-foreground lg:col-span-2">
                  SSH 密码
                  <input aria-label="SSH 密码" type="password" value={sshPassword} onChange={(event) => setSSHPassword(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20" />
                </label>
              ) : (
                <>
                  <label className="text-xs font-black text-foreground lg:col-span-2">
                    SSH 私钥
                    <textarea aria-label="SSH 私钥" value={sshPrivateKey} onChange={(event) => setSSHPrivateKey(event.target.value)} rows={4} className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-2 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20" />
                  </label>
                  <label className="text-xs font-black text-foreground lg:col-span-2">
                    私钥 Passphrase（可选）
                    <input aria-label="私钥 Passphrase" type="password" value={sshPassphrase} onChange={(event) => setSSHPassphrase(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20" />
                  </label>
                </>
              )}
              <label className="text-xs font-black text-foreground">
                节点 ID
                <input aria-label="节点 ID" value={sshNodeID} onChange={(event) => setSSHNodeID(event.target.value)} placeholder="node-1" className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20" />
              </label>
              <label className="text-xs font-black text-foreground">
                节点名称
                <input aria-label="节点名称" value={sshNodeName} onChange={(event) => setSSHNodeName(event.target.value)} placeholder="Oracle SG" className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/20" />
              </label>
              <div className="lg:col-span-2 rounded-2xl border border-success/30 bg-success/10 px-3 py-2 text-xs font-bold leading-5 text-success">
                默认以 root 运维模式安装，自动启用节点终端与 Docker 容器监控。
              </div>
              <div className="lg:col-span-2">
                <button type="button" onClick={startSSHInstallJob} disabled={sshInstallLoading} className="min-h-11 cursor-pointer rounded-2xl bg-success px-4 text-xs font-black text-primary-foreground shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50">
                  {sshInstallLoading ? '正在创建 SSH 安装任务...' : '开始 SSH 安装'}
                </button>
                {sshInstallMessage ? <p className="mt-2 rounded-2xl border border-success/30 bg-success/10 px-3 py-2 text-xs font-black text-success">{sshInstallMessage}</p> : null}
                {sshInstallError ? <p className="mt-2 rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-black text-danger">{sshInstallError}</p> : null}
              </div>
              {sshInstallEvents.length > 0 ? (
                <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-3 shadow-inner">
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">安装进度</p>
                  <ol className="space-y-2">
                    {sshInstallEvents.map((event) => (
                      <li key={event.step} className="flex items-start gap-3 rounded-2xl bg-surface px-3 py-2">
                        <span className={`mt-0.5 h-3 w-3 rounded-full ${event.status === 'success' ? 'bg-success' : event.status === 'failed' ? 'bg-danger' : event.status === 'running' ? 'bg-info' : 'bg-muted-foreground'}`} />
                        <span className="min-w-0">
                          <span className="block text-xs font-black text-foreground">{event.label}</span>
                          <span className="block text-xs font-black text-muted-foreground">{event.status === 'success' ? '成功' : event.status === 'failed' ? '失败' : event.status === 'running' ? '进行中' : '待执行'}</span>
                          {event.logs.length > 0 ? (
                            <span className="mt-1 block space-y-1">
                              {event.logs.map((log, index) => <span key={`${event.step}-${index}`} className="block break-words text-xs font-semibold leading-5 text-muted-foreground">{log}</span>)}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {sshInstallEvents.some((event) => event.done) ? (
                    <button type="button" onClick={closeInstallCommand} className="mt-3 min-h-10 cursor-pointer rounded-2xl bg-success px-4 text-xs font-black text-primary-foreground shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-primary/20">
                      {sshInstallEvents.some((event) => event.done && event.status === 'success') ? '完成并关闭' : '关闭'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {installMethod === 'manual' ? (
            <>
              <div className="mt-3 rounded-2xl border border-border bg-card p-3">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-success">简化状态</p>
                <ol className="mt-3 space-y-2">
                  <li className="flex items-start gap-3 rounded-2xl bg-card px-3 py-2">
                    <span className="mt-0.5 h-3 w-3 rounded-full bg-success" />
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-foreground">已生成一次性 install_token</span>
                      <span className="block text-xs font-bold text-muted-foreground">{installToken || '等待生成'}</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-3 rounded-2xl bg-card px-3 py-2">
                    <span className="mt-0.5 h-3 w-3 rounded-full bg-info" />
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-foreground">等待在目标机器执行命令</span>
                      <span className="block text-xs font-bold text-muted-foreground">复制命令到目标机器后执行即可。</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-3 rounded-2xl bg-card px-3 py-2">
                    <span className="mt-0.5 h-3 w-3 rounded-full bg-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-foreground">等待 Agent 首次注册</span>
                      <span className="block text-xs font-bold text-muted-foreground">安装完成后，Agent 会自动连接到 MizuPanel。</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-3 rounded-2xl bg-card px-3 py-2">
                    <span className="mt-0.5 h-3 w-3 rounded-full bg-code" />
                    <span className="min-w-0">
                      <span className="block text-xs font-black text-foreground">Agent 已连接，安装成功</span>
                      <span className="block text-xs font-bold text-muted-foreground">上线后就可以在主机列表看到节点。</span>
                    </span>
                  </li>
                </ol>
                <p className="mt-3 rounded-2xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-bold leading-5 text-warning">超时未连接时，请检查 server_url、防火墙或 Agent 日志。</p>
              </div>

              <div className="mt-3 flex w-fit rounded-2xl border border-border bg-card p-1 shadow-inner" aria-label="选择 Agent 安装系统">
                {(['linux', 'windows'] as const).map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    aria-pressed={installPlatform === platform}
                    onClick={() => selectInstallPlatform(platform)}
                    className={`min-h-9 cursor-pointer rounded-xl px-4 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${installPlatform === platform ? 'bg-code text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                  >
                    {platform === 'linux' ? 'Linux' : 'Windows'}
                  </button>
                ))}
              </div>
              <div className="mt-3 rounded-2xl border border-border bg-card px-3 py-2 shadow-inner">
                {installPlatform === 'linux' ? (
                  <p className="text-xs font-bold leading-5 text-success">默认以 root 运维模式安装，自动启用节点终端与 Docker 容器监控。</p>
                ) : (
                  <p className="text-xs font-bold leading-5 text-muted-foreground">Windows 暂不支持 Docker 监控和节点终端安装配置。</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-label={installCommandCopied ? '已复制' : '复制安装命令'}
                  onClick={copyInstallCommand}
                  disabled={!installCommand}
                  className="min-h-10 cursor-pointer rounded-2xl bg-success px-4 text-xs font-black text-primary-foreground shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {installCommandCopied ? '已复制' : '复制'}
                </button>
                <button
                  type="button"
                  aria-label="关闭安装命令"
                  onClick={closeInstallCommand}
                  className="min-h-10 cursor-pointer rounded-2xl border border-border bg-card px-4 text-xs font-black text-muted-foreground transition hover:border-success/50 hover:text-foreground focus:outline-none focus:ring-4 focus:ring-primary/20"
                >
                  关闭
                </button>
              </div>

              {installCommandLoading ? (
                <div className="bg-code px-4 py-4 text-xs font-bold leading-6 text-code-foreground">正在生成安装命令...</div>
              ) : installCommand ? (
                <pre className="overflow-x-auto bg-code px-4 py-4 text-xs leading-6 text-code-foreground"><code ref={installCommandCodeRef}>{installCommand}</code></pre>
              ) : (
                <div className="border-t border-danger/30 bg-danger/10 px-4 py-4 text-xs font-bold leading-5 text-danger">{installCommandError || '安装命令暂不可用，请重试。'}</div>
              )}
              {installCommandWarning ? (
                <div className="border-t border-warning/30 bg-warning/10 px-4 py-3 text-xs font-bold leading-5 text-warning">
                  {installCommandWarning}
                </div>
              ) : null}
              {installPlatform === 'windows' ? (
                <div className="border-t border-sky-200 bg-sky-50 px-4 py-3 text-xs font-bold leading-5 text-sky-700">
                  Windows 命令需要在管理员 PowerShell 中执行。
                </div>
              ) : null}
              <div className="border-t border-border bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-warning">
                token 来源：点击添加主机时，Server 会自动生成一次性 install_token。
              </div>
            </>
          ) : null}
        </div>
      </div>
      </section>
    </div>
  ) : null

  const latestMetrics = nodes.map((node) => node.latest_metric).filter((metric): metric is Metric => Boolean(metric))
  const networkIn = latestMetrics.reduce((sum, metric) => sum + metric.rx_speed, 0)
  const networkOut = latestMetrics.reduce((sum, metric) => sum + metric.tx_speed, 0)
  const averageLoad = latestMetrics.length === 0 ? 0 : latestMetrics.reduce((sum, metric) => sum + metric.load1, 0) / latestMetrics.length
  const contentCopy = pageCopy[page]
  const hostContent = (
    <div data-testid="host-page-container" className="mx-auto flex w-full max-w-[1400px] flex-col gap-3">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <TopStatCard title="节点总数" value={String(nodes.length)} subtitle={`在线 ${onlineNodes} · 离线 ${nodes.length - onlineNodes}`} tone="blue" />
        <TopStatCard title="平均 CPU" value={formatPercent(averages.cpu)} subtitle="最新采样" tone="green" />
        <TopStatCard title="平均内存" value={formatPercent(averages.memory)} subtitle="最新采样" tone="green" />
        <TopStatCard title="平均磁盘" value={formatPercent(averages.disk)} subtitle="最新采样" tone="orange" />
        <TopStatCard title="异常节点" value={String(nodes.length - onlineNodes)} subtitle="离线或未上报" tone="red" />
      </section>

      {nodes.length === 0 ? (
        <section className="rounded-[14px] border border-dashed border-border bg-card px-6 py-12 text-center shadow-sm">
          <p className="font-display text-3xl font-black text-foreground">暂无节点接入</p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">在目标服务器执行 Agent 安装命令后，节点会自动出现在这里。</p>
          <button
            ref={addHostButtonRef}
            type="button"
            onClick={showInstallCommand}
            aria-expanded={installCommandOpen}
            aria-controls="agent-install-command"
            className="mt-6 min-h-11 cursor-pointer rounded-xl bg-primary px-5 text-sm font-black text-primary-foreground shadow-sm transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/20"
          >
            安装目标主机 Agent 进行采集
          </button>
        </section>
      ) : (
        <div data-testid="host-main-grid" className="grid min-w-0 gap-3 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-start">
          <section data-testid="host-list-panel" className="min-w-0 rounded-[14px] border border-border bg-card p-3 shadow-sm xl:w-[320px]">
            <div className="mb-3 min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">主机列表</p>
              <h2 className="mt-1 text-lg font-black tracking-tight text-foreground">主机列表</h2>
            </div>
            <label htmlFor="host-search" className="sr-only">搜索主机</label>
            <input
              id="host-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索主机..."
              className="min-h-10 w-full rounded-xl border border-border bg-card px-3 text-sm font-semibold text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/15"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2" role="toolbar" aria-label="主机筛选与操作">
              <button type="button" aria-pressed={hostFilter === 'all'} onClick={() => setHostFilter('all')} className={hostFilterButtonClass('all', 'bg-foreground text-background shadow-sm focus:ring-primary/20', 'border border-border bg-card text-muted-foreground hover:text-foreground focus:ring-border')}>全部 {nodes.length}</button>
              <button type="button" aria-pressed={hostFilter === 'online'} onClick={() => setHostFilter('online')} className={hostFilterButtonClass('online', 'border border-success/30 bg-success/10 text-success shadow-sm focus:ring-success/20', 'border border-success/30 bg-card text-success hover:bg-success/10 focus:ring-success/20')}>在线 {onlineNodes}</button>
              <button type="button" aria-pressed={hostFilter === 'offline'} onClick={() => setHostFilter('offline')} className={hostFilterButtonClass('offline', 'border border-border bg-muted text-foreground shadow-sm focus:ring-border', 'border border-border bg-card text-muted-foreground hover:text-foreground focus:ring-border')}>离线 {nodes.length - onlineNodes}</button>
              <button
                ref={addHostButtonRef}
                type="button"
                onClick={showInstallCommand}
                aria-label="添加主机"
                aria-expanded={installCommandOpen}
                aria-controls="agent-install-command"
                className="ml-auto flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-lg font-black text-primary-foreground shadow-sm transition hover:brightness-110 focus:outline-none focus:ring-4 focus:ring-primary/20"
              >
                +
              </button>
            </div>
            <div className="mt-3">
              {filteredNodes.length > 0 ? (
                <NodeList nodes={filteredNodes} selectedNodeID={selectedNodeID} onSelectNode={(node) => setSelectedNodeID(node.id)} />
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-surface p-5 text-center">
                  <p className="text-sm font-black text-foreground">未找到匹配主机</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-muted-foreground">请调整筛选或搜索关键词。</p>
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs font-black text-muted-foreground">
              <span>共 {nodes.length} 台主机</span>
              <span>当前显示 {filteredNodes.length} 台</span>
            </div>
          </section>
          <NodeDetail node={visibleSelectedNode} metrics={selectedMetrics} processSnapshot={selectedProcessSnapshot} dockerSnapshot={selectedDockerSnapshot} monitoringLoading={monitoringLoading} range={range} onRangeChange={setRange} onLoadFiles={getNodeFiles} onReadFile={readNodeFile} onWriteFile={writeNodeFile} onUploadFile={uploadNodeFile} onDeletePath={deleteNodePath} onRebootNode={rebootNode} onSSHUninstall={startSSHUninstall} onGetAgentStatus={getAgentStatus} onRestartAgent={restartAgent} onGetAgentLogs={getAgentLogs} />
        </div>
      )}
    </div>
  )

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <div className={`sticky top-0 hidden h-screen shrink-0 transition-[width] duration-300 ease-in-out motion-reduce:transition-none md:block relative ${sidebarCollapsed ? 'w-[72px]' : 'w-[232px]'}`}>
          <aside
            aria-label="MizuPanel 侧边栏"
            data-collapsed={sidebarCollapsed ? 'true' : 'false'}
            className="flex h-full w-full overflow-hidden flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm transition-[width] duration-300 ease-in-out motion-reduce:transition-none"
          >
            <div className={`flex h-16 items-center border-b border-sidebar-border transition-[padding,justify-content] duration-300 ease-in-out motion-reduce:transition-none ${sidebarCollapsed ? 'justify-center px-2' : 'justify-start px-4'}`}>
              <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-black text-primary-foreground">M</div>
                <div className={`min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-in-out motion-reduce:transition-none ${sidebarCollapsed ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-[120px] translate-x-0 opacity-100'}`}>
                  <p className="truncate text-sm font-black text-sidebar-foreground">MizuPanel</p>
                  <p className="truncate text-[11px] font-bold text-muted-foreground">自托管监控面板</p>
                </div>
              </div>
            </div>
            <nav aria-label="侧边导航" className={`flex flex-1 flex-col gap-1 py-4 transition-[padding] duration-300 ease-in-out motion-reduce:transition-none ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
              {navItems.map((item) => {
                const active = page === item.page
                return (
                  <button
                    key={item.page}
                    type="button"
                    title={item.label}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => openPage(item.page)}
                    className={`flex min-h-11 cursor-pointer items-center rounded-xl text-sm font-black transition-[background-color,color,box-shadow,gap,padding] duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-primary/20 motion-reduce:transition-none ${active ? 'bg-sidebar-active text-sidebar-active-foreground shadow-sm' : 'text-sidebar-foreground hover:bg-muted hover:text-foreground'} ${sidebarCollapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-3'}`}
                  >
                    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-current"><NavIcon name={item.icon} /></span>
                    <span data-testid="sidebar-nav-label" className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform] duration-300 ease-in-out motion-reduce:transition-none ${sidebarCollapsed ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-[140px] translate-x-0 opacity-100'}`}>{item.label}</span>
                  </button>
                )
              })}
            </nav>
          </aside>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            className="absolute right-0 top-4 z-30 flex h-9 w-9 translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-sidebar-border bg-card text-sidebar-foreground shadow-sm transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-4 focus:ring-primary/20"
          >
            <CollapseIcon collapsed={sidebarCollapsed} />
          </button>
        </div>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-header-border bg-header/95 px-4 py-3 backdrop-blur md:px-6">
            <nav aria-label="移动端导航" className="mb-3 flex gap-2 overflow-x-auto md:hidden">
              {navItems.map((item) => (
                <button
                  key={item.page}
                  type="button"
                  aria-current={page === item.page ? 'page' : undefined}
                  onClick={() => openPage(item.page)}
                  className={`inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${page === item.page ? 'bg-primary text-primary-foreground shadow-sm' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`}
                >
                  <NavIcon name={item.icon} />
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="flex justify-end">
              <h1 className="sr-only">{contentCopy.title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                {authenticated && currentUsername ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-foreground">{currentUsername}</span>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="min-h-9 cursor-pointer rounded-xl border border-border bg-card px-3 text-xs font-black text-muted-foreground transition hover:border-danger/50 hover:text-danger focus:outline-none focus:ring-4 focus:ring-primary/20"
                    >
                      退出登录
                    </button>
                  </div>
                ) : null}
                <div className="flex rounded-xl border border-border bg-card p-1" aria-label="主题切换">
                  {(['light', 'dark'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setTheme(item)}
                      aria-pressed={theme === item}
                      className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${theme === item ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                    >
                      {item === 'light' ? <SunIcon /> : <MoonIcon />}
                      {item === 'light' ? 'Light' : 'Dark'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </header>

          <div className="flex-1 px-3 py-4 sm:px-5 lg:px-6">
            <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-4">
              {error ? <div className="rounded-xl border border-danger/30 bg-danger/10 px-5 py-4 font-semibold text-danger shadow-sm">{error}</div> : null}

              {installCommandDialog}

              {page === 'overview' ? (
                <>
                  <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label="节点总数" value={String(nodes.length)} detail="已注册 Agent" />
                    <MetricCard label="在线节点" value={String(onlineNodes)} tone="green" detail={`${nodes.length - onlineNodes} 个离线`} />
                    <MetricCard label="平均 CPU" value={formatPercent(averages.cpu)} tone="amber" detail="最新采样" />
                    <MetricCard label="平均内存" value={formatPercent(averages.memory)} tone="slate" detail="最新采样" />
                    <MetricCard label="平均磁盘" value={formatPercent(averages.disk)} tone="amber" detail="最新采样" />
                    <MetricCard label="平均负载" value={averageLoad.toFixed(2)} detail="Load 1" />
                    <MetricCard label="下行汇总" value={formatSpeed(networkIn)} tone="green" detail="所有在线采样" />
                    <MetricCard label="上行汇总" value={formatSpeed(networkOut)} tone="slate" detail="所有在线采样" />
                  </section>
                  <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="rounded-2xl border border-border bg-card p-5 shadow-glass">
                      <h2 className="text-lg font-black text-foreground">节点状态摘要</h2>
                      {nodes.length > 0 ? (
                        <div className="mt-4 grid gap-3">
                          {nodes.map((node) => (
                            <div key={node.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-black text-foreground">{node.name}</p>
                                <p className="mt-1 text-xs font-bold text-muted-foreground">{node.ip} · {node.os} · {node.arch}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs font-black">
                                <span className={`rounded-full px-3 py-1 ${node.status === 'online' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>{node.status === 'online' ? '在线' : '离线'}</span>
                                <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">CPU {node.latest_metric ? formatPercent(node.latest_metric.cpu_usage) : '—'}</span>
                                <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">内存 {node.latest_metric ? formatPercent(node.latest_metric.memory_usage) : '—'}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm font-bold text-muted-foreground">等待节点接入</div>
                      )}
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-5 shadow-glass">
                      <h2 className="text-lg font-black text-foreground">指标数据状态</h2>
                      <p className="mt-2 text-sm font-semibold leading-6 text-muted-foreground">概览只聚合现有 Agent 上报数据；无指标的节点不会填充模拟值。</p>
                      <div className="mt-5 rounded-xl border border-border bg-surface p-4">
                        <p className="text-3xl font-black text-foreground">{latestMetrics.length}</p>
                        <p className="mt-1 text-xs font-bold text-muted-foreground">已有最新指标的节点数</p>
                      </div>
                    </div>
                  </section>
                </>
              ) : page === 'history' ? (
                <HistoryPage nodes={nodes} selectedNodeID={selectedNodeID} metrics={metrics} range={range} settings={settings} onSelectNode={setSelectedNodeID} onRangeChange={setRange} />
              ) : page === 'settings' ? (
                <SystemSettingsPage settings={settings} selectedRetention={settingsRetention} saving={settingsSaving} message={settingsMessage} error={settingsError} onSelectRetention={setSettingsRetention} onSave={saveSettings} />
              ) : page === 'logs' ? (
                <section className="rounded-2xl border border-border bg-card p-5 shadow-glass">
                  <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h2 className="text-xl font-black text-foreground">日志控制台</h2>
                      <p className="mt-1 text-sm font-semibold text-muted-foreground">保留日志控制台结构，等待后端日志接口接入。</p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input aria-label="搜索日志" placeholder="搜索日志..." className="min-h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/15" />
                      <select aria-label="日志级别" className="min-h-10 rounded-xl border border-border bg-card px-3 text-sm font-black text-foreground outline-none focus:border-primary focus:ring-4 focus:ring-primary/15">
                        <option>全部级别</option>
                      </select>
                    </div>
                  </div>
                  <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
                    <p className="text-2xl font-black text-foreground">等待日志接口接入</p>
                    <p className="mx-auto mt-3 max-w-xl text-sm font-semibold leading-6 text-muted-foreground">当前不请求新接口、不展示模拟日志；接入真实日志 API 后这里会显示可搜索、可筛选的节点日志。</p>
                  </div>
                </section>
              ) : hostContent}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function TopStatCard({ title, value, subtitle, tone }: { title: string, value: string, subtitle: string, tone: 'blue' | 'green' | 'orange' | 'red' }) {
  const dotClass = tone === 'green' ? 'bg-success' : tone === 'orange' ? 'bg-warning' : tone === 'red' ? 'bg-danger' : 'bg-info'
  return (
    <div className="h-[96px] rounded-[14px] border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="truncate text-xs font-black text-muted-foreground">{title}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
      </div>
      <p className="font-display text-2xl font-black tracking-tight text-foreground">{value}</p>
      <p className="mt-1 truncate text-xs font-semibold text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function NavIcon({ name }: { name: 'overview' | 'hosts' | 'history' | 'settings' | 'logs' }) {
  const common = "h-5 w-5"
  if (name === 'overview') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>
  }
  if (name === 'hosts') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="6" rx="2" /><rect x="4" y="14" width="16" height="6" rx="2" /><path d="M7.5 7h.01M7.5 17h.01M11 7h6M11 17h6" /></svg>
  }
  if (name === 'history') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.35-5.65" /><path d="M4 5.5v4h4" /><path d="M12 8v4l2.5 2" /></svg>
  }
  if (name === 'settings') {
    return <svg aria-hidden="true" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5v2.25M12 18.25v2.25M5.99 5.99l1.6 1.6M16.41 16.41l1.6 1.6M3.5 12h2.25M18.25 12h2.25M5.99 18.01l1.6-1.6M16.41 7.59l1.6-1.6" /><circle cx="12" cy="12" r="3.5" /></svg>
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 3.5h8L19.5 8v12.5h-13z" /><path d="M14.5 3.5V8h5" /><path d="M9 12h6M9 16h6" /></svg>
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
      <path d={collapsed ? 'm14 9 3 3-3 3' : 'm10 9-3 3 3 3'} />
    </svg>
  )
}

function SunIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" /></svg>
}

function MoonIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 7 7 0 1 0 20.5 14.5Z" /></svg>
}

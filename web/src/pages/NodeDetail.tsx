import { useEffect, useMemo, useRef, useState } from 'react'

import type { AgentLogsResponse, AgentRestartResponse, AgentStatusResponse, DockerContainer, DockerSnapshotResponse, FileDeleteResponse, FileEntry, FileListResponse, FileReadResponse, FileUploadResponse, FileWriteResponse, Metric, Node, ProcessInfo, ProcessSnapshotResponse, RangeOption, RebootResponse, SSHAuthType, SSHJobResponse, SSHProgressEvent, SSHUninstallRequest } from '../types'
import { formatBytes, formatPercent, formatSpeed } from '../lib/format'
import { MetricsChart } from '../components/MetricsChart'
import LogViewer from '../components/LogViewer'
import ContainerLogsModal from '../components/ContainerLogsModal'
import CreateContainerModal from '../components/CreateContainerModal'
import { Toast } from '../components/Toast'

type NodeDetailProps = {
  node?: Node
  metrics: Metric[]
  processSnapshot?: ProcessSnapshotResponse
  dockerSnapshot?: DockerSnapshotResponse
  monitoringLoading?: boolean
  range: RangeOption
  onRangeChange: (range: RangeOption) => void
  onLoadFiles?: (nodeID: string, path: string) => Promise<FileListResponse>
  onReadFile?: (nodeID: string, path: string) => Promise<FileReadResponse>
  onWriteFile?: (nodeID: string, path: string, content: string) => Promise<FileWriteResponse>
  onUploadFile?: (nodeID: string, path: string, contentBase64: string) => Promise<FileUploadResponse>
  onDeletePath?: (nodeID: string, path: string) => Promise<FileDeleteResponse>
  onRebootNode?: (nodeID: string) => Promise<RebootResponse>
  onSSHUninstall?: (nodeID: string, request: SSHUninstallRequest) => Promise<SSHJobResponse>
  onGetAgentStatus?: (nodeID: string) => Promise<AgentStatusResponse>
  onRestartAgent?: (nodeID: string) => Promise<AgentRestartResponse>
  onGetAgentLogs?: (nodeID: string, lines: number) => Promise<AgentLogsResponse>
  onRefreshDocker?: (nodeID: string) => Promise<void>
}

type DetailSection = 'overview' | 'processes' | 'containers' | 'files' | 'logs' | 'agent'
type ProcessSort = 'cpu' | 'memory' | 'pid' | 'name'
type DockerFilter = 'all' | 'running' | 'stopped' | 'abnormal'
type SSHProgressEventLog = SSHProgressEvent & { logs: string[] }
type ChartRange = Extract<RangeOption, '1h' | '6h'>

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

export function NodeDetail({ node, metrics, processSnapshot, dockerSnapshot, monitoringLoading = false, range, onRangeChange, onLoadFiles, onReadFile, onWriteFile, onUploadFile, onDeletePath, onRebootNode, onSSHUninstall, onGetAgentStatus, onRestartAgent, onGetAgentLogs, onRefreshDocker }: NodeDetailProps) {
  const [activeSection, setActiveSection] = useState<DetailSection>('overview')
  const [processSort, setProcessSort] = useState<ProcessSort>('cpu')
  const [processSearch, setProcessSearch] = useState('')
  const [dockerFilter, setDockerFilter] = useState<DockerFilter>('all')
  const [dockerSearch, setDockerSearch] = useState('')
  const [containerLogsModal, setContainerLogsModal] = useState<{ open: boolean; containerId: string; containerName: string }>({
    open: false,
    containerId: '',
    containerName: '',
  })
  const [createContainerModal, setCreateContainerModal] = useState(false)
  const [chartRanges, setChartRanges] = useState<Record<string, ChartRange>>({ cpu: '1h', memory: '1h', disk: '1h', network: '1h', diskIO: '1h', load: '1h' })
  const [fileList, setFileList] = useState<FileListResponse>()
  const [fileRead, setFileRead] = useState<FileReadResponse>()
  const [fileContent, setFileContent] = useState('')
  const [pathInput, setPathInput] = useState('/')
  const [editorOpen, setEditorOpen] = useState(false)
  const fileRequestSeq = useRef(0)
  const agentRequestSeq = useRef(0)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [operationMessage, setOperationMessage] = useState<string>()
  const [fileLoading, setFileLoading] = useState(false)
  const [sshUninstallOpen, setSSHUninstallOpen] = useState(false)
  const [sshAuthType, setSSHAuthType] = useState<SSHAuthType>('password')
  const [sshHost, setSSHHost] = useState('')
  const [sshPort, setSSHPort] = useState(22)
  const [sshPassword, setSSHPassword] = useState('')
  const [sshPrivateKey, setSSHPrivateKey] = useState('')
  const [sshPassphrase, setSSHPassphrase] = useState('')
  const [sshRemoveRecord, setSSHRemoveRecord] = useState(true)
  const [sshUninstallLoading, setSSHUninstallLoading] = useState(false)
  const [sshUninstallMessage, setSSHUninstallMessage] = useState<string>()
  const [sshUninstallError, setSSHUninstallError] = useState<string>()
  const [sshUninstallEvents, setSSHUninstallEvents] = useState<SSHProgressEventLog[]>([])
  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse>()
  const [agentLogs, setAgentLogs] = useState<AgentLogsResponse>()
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentMessage, setAgentMessage] = useState<string>()
  const [agentError, setAgentError] = useState<string>()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    agentRequestSeq.current += 1
    setAgentStatus(undefined)
    setAgentLogs(undefined)
    setAgentMessage(undefined)
    setAgentError(undefined)
    setAgentLoading(false)
    if (!node || activeSection !== 'agent') return
    const requestID = agentRequestSeq.current
    if (node.status !== 'online') {
      setAgentError('节点离线，无法获取 Agent 管理信息。')
      return
    }
    setAgentLoading(true)
    Promise.allSettled([
      onGetAgentStatus ? onGetAgentStatus(node.id) : Promise.resolve(undefined),
      onGetAgentLogs ? onGetAgentLogs(node.id, 100) : Promise.resolve(undefined)
    ])
      .then(([statusResult, logsResult]) => {
        if (requestID !== agentRequestSeq.current) return
        if (statusResult.status === 'fulfilled' && statusResult.value) {
          setAgentStatus(statusResult.value)
        } else if (statusResult.status === 'rejected') {
          setAgentError(statusResult.reason instanceof Error ? statusResult.reason.message : 'Agent 状态加载失败')
        }
        if (logsResult.status === 'fulfilled' && logsResult.value) {
          setAgentLogs(logsResult.value)
          if (logsResult.value.error) setAgentError(logsResult.value.error)
        } else if (logsResult.status === 'rejected') {
          setAgentError(logsResult.reason instanceof Error ? logsResult.reason.message : 'Agent 日志加载失败')
        }
      })
      .finally(() => {
        if (requestID === agentRequestSeq.current) setAgentLoading(false)
      })
  }, [node?.id, node?.status])

  const filteredProcesses = useMemo(() => {
    const keyword = processSearch.trim().toLowerCase()
    const rows = [...(processSnapshot?.processes ?? [])]
      .filter((process) => {
        if (!keyword) return true
        return [process.pid.toString(), process.name, process.user, process.status]
          .some((value) => value.toLowerCase().includes(keyword))
      })
    rows.sort((left, right) => compareProcesses(left, right, processSort))
    return rows
  }, [processSearch, processSnapshot, processSort])

  const filteredContainers = useMemo(() => {
    const keyword = dockerSearch.trim().toLowerCase()
    return (dockerSnapshot?.containers ?? [])
      .filter((container) => dockerFilter === 'all' || dockerFilterFor(container) === dockerFilter)
      .filter((container) => {
        if (!keyword) return true
        return [container.id, container.name, container.image, container.state, container.status]
          .some((value) => value.toLowerCase().includes(keyword))
      })
  }, [dockerFilter, dockerSearch, dockerSnapshot])

  if (!node) {
    return null
  }

  const metric = node.latest_metric
  const latestChartMetric = mergeMetricFallback(metrics.length > 0 ? metrics[metrics.length - 1] : undefined, metric)
  const uptimeText = formatUptime(latestChartMetric?.uptime)
  const bootTimeText = formatBootTime(latestChartMetric)
  const displayName = node.name || node.hostname
  const online = node.status === 'online'
  const agentModeLabel = node.agent_mode === 'ops' ? '运维模式' : '普通模式'
  const agentUserLabel = node.agent_user || '未知用户'
  const nextFileRequest = () => {
    fileRequestSeq.current += 1
    return fileRequestSeq.current
  }
  const isLatestFileRequest = (requestID: number) => requestID === fileRequestSeq.current

  const loadFiles = (path: string) => {
    if (!online || !onLoadFiles) {
      setOperationMessage('节点离线，无法发送文件管理命令。')
      return
    }
    setActiveSection('files')
    setFileLoading(true)
    setOperationMessage(undefined)
    const requestID = nextFileRequest()
    onLoadFiles(node.id, path)
      .then((response) => {
        if (!isLatestFileRequest(requestID)) return
        setFileList(response)
        setFileRead(undefined)
        setFileContent('')
        setEditorOpen(false)
        if (!response.error) setPathInput(response.path || path)
        if (response.error) setOperationMessage(formatOperationError(response.code, response.error))
      })
      .catch((err: unknown) => {
        if (isLatestFileRequest(requestID)) setOperationMessage(err instanceof Error ? err.message : '文件目录加载失败')
      })
      .finally(() => {
        if (isLatestFileRequest(requestID)) setFileLoading(false)
      })
  }

  const openFileEntry = (entry: FileEntry) => {
    if (entry.type === 'directory') {
      loadFiles(entry.path)
      return
    }
    setFileLoading(false)
    if (entry.type === 'binary') {
      nextFileRequest()
      setEditorOpen(false)
      setOperationMessage('二进制文件不可编辑')
      return
    }
    if (!onReadFile) return
    setOperationMessage(undefined)
    const requestID = nextFileRequest()
    onReadFile(node.id, entry.path)
      .then((response) => {
        if (!isLatestFileRequest(requestID)) return
        setFileRead(response)
        setFileContent(response.content || '')
        setEditorOpen(Boolean(response.editable && !response.error))
        if (response.error) setOperationMessage(formatOperationError(response.code, response.error))
      })
      .catch((err: unknown) => {
        if (isLatestFileRequest(requestID)) setOperationMessage(err instanceof Error ? err.message : '文件读取失败')
      })
  }

  const openPath = () => {
    const target = pathInput.trim() || '/'
    if (!online || !onLoadFiles) {
      setOperationMessage('节点离线，无法发送文件管理命令。')
      return
    }
    setActiveSection('files')
    setFileLoading(true)
    setOperationMessage(undefined)
    const requestID = nextFileRequest()
    onLoadFiles(node.id, target)
      .then((response) => {
        if (!isLatestFileRequest(requestID)) return
        if (!response.error) {
          setFileList(response)
          setPathInput(response.path || target)
          setFileRead(undefined)
          setFileContent('')
          setEditorOpen(false)
          return
        }
        if (response.code === 'not_directory' && onReadFile) {
          return onReadFile(node.id, target).then((readResponse) => {
            if (!isLatestFileRequest(requestID)) return
            setFileRead(readResponse)
            setFileContent(readResponse.content || '')
            setEditorOpen(Boolean(readResponse.editable && !readResponse.error))
            if (readResponse.error) setOperationMessage(formatOperationError(readResponse.code, readResponse.error))
          })
        }
        setEditorOpen(false)
        setOperationMessage(formatOperationError(response.code, response.error))
      })
      .catch((err: unknown) => {
        if (isLatestFileRequest(requestID)) setOperationMessage(err instanceof Error ? err.message : '路径打开失败')
      })
      .finally(() => {
        if (isLatestFileRequest(requestID)) setFileLoading(false)
      })
  }

  const saveFile = () => {
    if (!fileRead || !onWriteFile) return
    setOperationMessage(undefined)
    onWriteFile(node.id, fileRead.path, fileContent)
      .then((response) => {
        setOperationMessage(response.saved ? '文件已保存。' : formatOperationError(response.code, response.error || '文件保存失败'))
      })
      .catch((err: unknown) => setOperationMessage(err instanceof Error ? err.message : '文件保存失败'))
  }

  const uploadFile = (file?: File) => {
    if (!file || !onUploadFile) return
    if (!online || !onLoadFiles) {
      setOperationMessage('节点离线，无法上传文件。')
      return
    }
    const directory = fileList?.path || '/'
    const targetPath = joinRemotePath(directory, file.name)
    const requestID = nextFileRequest()
    setFileLoading(true)
    setOperationMessage(undefined)
    fileToBase64(file)
      .then((contentBase64) => onUploadFile(node.id, targetPath, contentBase64))
      .then((response) => {
        if (!isLatestFileRequest(requestID)) return undefined
        setOperationMessage(response.uploaded ? '文件已上传。' : formatOperationError(response.code, response.error || '文件上传失败'))
        if (!response.uploaded) return undefined
        return onLoadFiles(node.id, directory)
      })
      .then((response) => {
        if (!response || !isLatestFileRequest(requestID)) return
        if (!response.error) {
          setFileList(response)
          setPathInput(response.path || directory)
        } else {
          setOperationMessage(formatOperationError(response.code, response.error))
        }
      })
      .catch((err: unknown) => {
        if (isLatestFileRequest(requestID)) setOperationMessage(err instanceof Error ? err.message : '文件上传失败')
      })
      .finally(() => {
        if (isLatestFileRequest(requestID)) setFileLoading(false)
      })
  }

  const deleteEntry = (entry: FileEntry) => {
    if (!onDeletePath || !onLoadFiles) return
    const confirmed = window.confirm(`确认删除 ${entry.path}？\n仅按当前 Agent 运行用户权限执行；非空目录不会被递归删除。`)
    if (!confirmed) return
    const directory = fileList?.path || '/'
    const requestID = nextFileRequest()
    setFileLoading(true)
    setOperationMessage(undefined)
    onDeletePath(node.id, entry.path)
      .then((response) => {
        if (!isLatestFileRequest(requestID)) return undefined
        setOperationMessage(response.deleted ? '文件已删除。' : formatOperationError(response.code, response.error || '文件删除失败'))
        if (!response.deleted) return undefined
        return onLoadFiles(node.id, directory)
      })
      .then((response) => {
        if (!response || !isLatestFileRequest(requestID)) return
        if (!response.error) {
          setFileList(response)
          setPathInput(response.path || directory)
        } else {
          setOperationMessage(formatOperationError(response.code, response.error))
        }
      })
      .catch((err: unknown) => {
        if (isLatestFileRequest(requestID)) setOperationMessage(err instanceof Error ? err.message : '文件删除失败')
      })
      .finally(() => {
        if (isLatestFileRequest(requestID)) setFileLoading(false)
      })
  }

  const reboot = () => {
    if (!online || !onRebootNode) {
      setOperationMessage('节点离线，无法发送重启命令。')
      return
    }
    const confirmed = window.confirm(`确认重启节点 ${displayName}？\n该操作会以当前 Agent 运行用户执行。\n当前执行用户：${node.agent_user || '未知'}`)
    if (!confirmed) return
    setOperationMessage(undefined)
    onRebootNode(node.id)
      .then((response) => setOperationMessage(response.accepted ? '重启命令已发送，节点可能会暂时离线，请稍后等待 Agent 重新连接。' : formatOperationError(response.code, response.error || '重启命令发送失败')))
      .catch((err: unknown) => setOperationMessage(err instanceof Error ? err.message : '重启命令发送失败'))
  }

  const closeSSHUninstallDialog = () => {
    setSSHHost('')
    setSSHPort(22)
    setSSHAuthType('password')
    setSSHPassword('')
    setSSHPrivateKey('')
    setSSHPassphrase('')
    setSSHRemoveRecord(true)
    setSSHUninstallLoading(false)
    setSSHUninstallMessage(undefined)
    setSSHUninstallError(undefined)
    setSSHUninstallEvents([])
    setSSHUninstallOpen(false)
  }

  const openSSHUninstallDialog = () => {
    setSSHHost(node.ip || '')
    setSSHPort(22)
    setSSHAuthType('password')
    setSSHPassword('')
    setSSHPrivateKey('')
    setSSHPassphrase('')
    setSSHRemoveRecord(true)
    setSSHUninstallMessage(undefined)
    setSSHUninstallError(undefined)
    setSSHUninstallEvents([])
    setSSHUninstallOpen(true)
  }

  const subscribeSSHUninstallProgress = (jobID: string) => {
    const source = new EventSource(`/api/nodes/${encodeURIComponent(node.id)}/ssh-uninstall/${encodeURIComponent(jobID)}/events`)
    source.onmessage = (event) => {
      const progress = JSON.parse(event.data) as SSHProgressEvent
      setSSHUninstallEvents((current) => mergeSSHProgressEvent(current, progress))
      if (progress.done) source.close()
    }
    source.onerror = () => source.close()
  }

  const startSSHUninstall = () => {
    if (!onSSHUninstall || sshUninstallLoading) return
    setSSHUninstallLoading(true)
    setSSHUninstallMessage(undefined)
    setSSHUninstallError(undefined)
    onSSHUninstall(node.id, {
      host: sshHost.trim(),
      port: sshPort || 22,
      username: 'root',
      auth_type: sshAuthType,
      ...(sshAuthType === 'password' ? { password: sshPassword } : { private_key: sshPrivateKey, ...(sshPassphrase ? { passphrase: sshPassphrase } : {}) }),
      remove_node_record: sshRemoveRecord
    })
      .then((response) => {
        setSSHUninstallMessage(`SSH 卸载任务已创建：${response.job_id}`)
        subscribeSSHUninstallProgress(response.job_id)
      })
      .catch((err: unknown) => setSSHUninstallError(err instanceof Error ? err.message : 'SSH 卸载任务创建失败'))
      .finally(() => setSSHUninstallLoading(false))
  }

  const loadAgentManagement = () => {
    setActiveSection('agent')
    setAgentStatus(undefined)
    setAgentLogs(undefined)
    setAgentMessage(undefined)
    setAgentError(undefined)
    const requestID = agentRequestSeq.current + 1
    agentRequestSeq.current = requestID
    if (!online) {
      setAgentError('节点离线，无法获取 Agent 管理信息。')
      return
    }
    setAgentLoading(true)
    Promise.allSettled([
      onGetAgentStatus ? onGetAgentStatus(node.id) : Promise.resolve(undefined),
      onGetAgentLogs ? onGetAgentLogs(node.id, 100) : Promise.resolve(undefined)
    ])
      .then(([statusResult, logsResult]) => {
        if (requestID !== agentRequestSeq.current) return
        if (statusResult.status === 'fulfilled' && statusResult.value) {
          setAgentStatus(statusResult.value)
        } else if (statusResult.status === 'rejected') {
          setAgentError(statusResult.reason instanceof Error ? statusResult.reason.message : 'Agent 状态加载失败')
        }
        if (logsResult.status === 'fulfilled' && logsResult.value) {
          setAgentLogs(logsResult.value)
          if (logsResult.value.error) setAgentError(logsResult.value.error)
        } else if (logsResult.status === 'rejected') {
          setAgentError(logsResult.reason instanceof Error ? logsResult.reason.message : 'Agent 日志加载失败')
        }
      })
      .finally(() => {
        if (requestID === agentRequestSeq.current) setAgentLoading(false)
      })
  }

  const refreshAgentLogs = () => {
    if (!online || !onGetAgentLogs) {
      setAgentError('节点离线，无法获取 Agent 日志。')
      return
    }
    const requestID = agentRequestSeq.current + 1
    agentRequestSeq.current = requestID
    setAgentLoading(true)
    setAgentError(undefined)
    onGetAgentLogs(node.id, 100)
      .then((logs) => {
        if (requestID !== agentRequestSeq.current) return
        setAgentLogs(logs)
        if (logs.error) setAgentError(logs.error)
      })
      .catch((err: unknown) => {
        if (requestID === agentRequestSeq.current) setAgentError(err instanceof Error ? err.message : 'Agent 日志加载失败')
      })
      .finally(() => {
        if (requestID === agentRequestSeq.current) setAgentLoading(false)
      })
  }

  const restartAgentService = () => {
    if (!online || !onRestartAgent) {
      setAgentError('节点离线，无法重启 Agent。')
      return
    }
    const confirmed = window.confirm(`确认重启 ${agentStatus?.service_name || 'mizupanel-agent'}？\n重启后 Agent 会短暂断开并自动重新连接。`)
    if (!confirmed) return
    setAgentMessage(undefined)
    setAgentError(undefined)
    onRestartAgent(node.id)
      .then((response) => setAgentMessage(response.accepted ? response.message || '重启命令已下发，等待 Agent 重新连接' : formatOperationError(response.code, response.error || 'Agent 重启命令发送失败')))
      .catch((err: unknown) => setAgentError(err instanceof Error ? err.message : 'Agent 重启命令发送失败'))
  }

  const handleCreateContainer = async (nodeId: string, command: string) => {
    try {
      setOperationMessage(undefined)
      const response = await fetch(`/api/nodes/${nodeId}/docker/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '执行失败')
      }

      if (!result.accepted) {
        throw new Error(result.error || '命令被拒绝')
      }

      if (result.exit_code !== 0) {
        setOperationMessage(`容器创建失败 (退出码: ${result.exit_code})\n${result.output || result.error || ''}`)
        return
      }

      setOperationMessage(`容器创建成功！\n${result.output || ''}`)

      // Docker data refreshes automatically via snapshot polling
      setCreateContainerModal(false)
    } catch (error) {
      setOperationMessage(`容器创建失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <section className="min-w-0 space-y-2">
      <div className="rounded-[14px] border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate font-display text-2xl font-black tracking-tight text-foreground">{displayName}</h2>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${online ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>{online ? '在线' : '离线'}</span>
            </div>
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              {node.ip || '未知 IP'} · {node.os}/{node.arch} · {node.hostname || '未知主机'} · 运行时间 {uptimeText}
            </p>
            <p className="mt-1 text-xs font-black text-muted-foreground">{agentModeLabel} · {agentUserLabel}</p>
          </div>
          <div role="toolbar" aria-label="节点操作" className="flex flex-wrap justify-start gap-2 lg:justify-end">
            <button
              type="button"
              aria-label="打开终端"
              title={node.terminal_enabled ? '打开终端' : '该节点未启用终端'}
              disabled={!node.terminal_enabled}
              onClick={() => openTerminalPage(node.id)}
              className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-success/30 bg-success px-3 text-xs font-black text-primary-foreground shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
            >
              <TerminalIcon />
              终端
            </button>
            <button
              type="button"
              aria-label="文件"
              title="文件管理"
              disabled={!online}
              onClick={() => loadFiles(fileList?.path || '/')}
              className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-black text-success shadow-sm transition hover:border-success/40 hover:bg-success/10 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              <FileIcon />
              文件
            </button>
            <button
              type="button"
              aria-label="重启"
              title="重启节点"
              disabled={!online}
              onClick={reboot}
              className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 text-xs font-black text-warning shadow-sm transition hover:bg-warning/15 focus:outline-none focus:ring-4 focus:ring-warning/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            >
              <PowerIcon />
              重启
            </button>
          </div>
        </div>
      </div>

      {operationMessage && activeSection !== 'files' ? <p className="rounded-[28px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-black text-warning">{operationMessage}</p> : null}

      <div className="flex flex-wrap gap-1 rounded-[14px] border border-border bg-card px-2 py-1.5 shadow-sm" role="group" aria-label="节点详情视图">
        {([
          ['overview', '监控概览'],
          ['processes', '进程信息'],
          ['containers', '容器信息'],
          ['files', '文件管理'],
          ['logs', '日志查看'],
          ['agent', 'Agent 管理']
        ] as const).map(([section, label]) => (
          <button
            key={section}
            type="button"
            aria-pressed={activeSection === section}
            onClick={() => section === 'files' ? loadFiles(fileList?.path || '/') : section === 'agent' ? loadAgentManagement() : setActiveSection(section)}
            className={`min-h-9 cursor-pointer rounded-xl px-3 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${activeSection === section ? 'bg-primary/10 text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSection === 'overview' ? (
        <>
          <section aria-label="基础信息" className="rounded-[14px] border border-border bg-card p-3 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-base font-black text-foreground">基础信息</h3>
              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-black text-muted-foreground">最新采样</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <InfoBlock label="操作系统" value={node.os || '未知'} />
              <InfoBlock label="内核版本" value={node.kernel || '未知'} />
              <InfoBlock label="架构" value={node.arch || '未知'} />
              <InfoBlock label="启动时间" value={bootTimeText} />
              <InfoBlock label="运行时间" value={uptimeText} />
              <InfoBlock label="系统负载" value={formatLoadSummary(metric)} wrap />
            </div>
          </section>

          <div data-testid="node-detail-charts" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <MetricsChart metrics={filterMetricsByChartRange(metrics, chartRanges.cpu)} dataKey="cpu_usage" title="CPU 使用率" color="rgb(var(--chart-cpu))" summaryItems={[{ value: latestChartMetric ? formatPercent(latestChartMetric.cpu_usage) : '—' }]} range={chartRanges.cpu} onRangeChange={(nextRange) => updateChartRange('cpu', nextRange, range, onRangeChange, setChartRanges)} />
            <MetricsChart metrics={filterMetricsByChartRange(metrics, chartRanges.memory)} dataKey="memory_usage" title="内存使用率" color="rgb(var(--chart-memory))" summaryItems={[{ value: latestChartMetric ? formatPercent(latestChartMetric.memory_usage) : '—' }]} range={chartRanges.memory} onRangeChange={(nextRange) => updateChartRange('memory', nextRange, range, onRangeChange, setChartRanges)} />
            <MetricsChart metrics={filterMetricsByChartRange(metrics, chartRanges.disk)} dataKey="disk_usage" title="磁盘使用率" color="rgb(var(--chart-disk))" summaryItems={[{ value: latestChartMetric ? formatPercent(latestChartMetric.disk_usage) : '—' }]} range={chartRanges.disk} onRangeChange={(nextRange) => updateChartRange('disk', nextRange, range, onRangeChange, setChartRanges)} />
            <MetricsChart metrics={filterMetricsByChartRange(metrics, chartRanges.network)} title="网络 I/O" color="rgb(var(--chart-network-in))" unitLabel="bytes/s" domain={[0, 'auto']} summaryItems={[{ label: '上行', value: latestChartMetric ? formatSpeed(latestChartMetric.tx_speed) : '—', color: 'rgb(var(--chart-network-out))' }, { label: '下行', value: latestChartMetric ? formatSpeed(latestChartMetric.rx_speed) : '—', color: 'rgb(var(--chart-network-in))' }]} range={chartRanges.network} onRangeChange={(nextRange) => updateChartRange('network', nextRange, range, onRangeChange, setChartRanges)} series={[{ dataKey: 'rx_speed', label: '下行', color: 'rgb(var(--chart-network-in))', unitLabel: 'bytes/s' }, { dataKey: 'tx_speed', label: '上行', color: 'rgb(var(--chart-network-out))', unitLabel: 'bytes/s' }]} />
            <MetricsChart metrics={filterMetricsByChartRange(metrics, chartRanges.diskIO)} title="磁盘 I/O" color="rgb(var(--chart-disk))" unitLabel="bytes/s" domain={[0, 'auto']} summaryItems={[{ label: '读', value: latestChartMetric ? formatSpeed(latestChartMetric.disk_read_speed) : '—', color: 'rgb(var(--chart-network-out))' }, { label: '写', value: latestChartMetric ? formatSpeed(latestChartMetric.disk_write_speed) : '—', color: 'rgb(var(--chart-network-in))' }]} range={chartRanges.diskIO} onRangeChange={(nextRange) => updateChartRange('diskIO', nextRange, range, onRangeChange, setChartRanges)} series={[{ dataKey: 'disk_read_speed', label: '读', color: 'rgb(var(--chart-network-out))', unitLabel: 'bytes/s' }, { dataKey: 'disk_write_speed', label: '写', color: 'rgb(var(--chart-network-in))', unitLabel: 'bytes/s' }]} emptyText="当前 Agent 暂未上报磁盘 I/O 指标" />
            <MetricsChart metrics={filterMetricsByChartRange(metrics, chartRanges.load)} title="系统负载" color="rgb(var(--chart-load))" unitLabel="load" domain={[0, 'auto']} summaryItems={[{ label: '1m', value: latestChartMetric ? latestChartMetric.load1.toFixed(2) : '—', color: 'rgb(var(--chart-load))' }, { label: '5m', value: latestChartMetric ? latestChartMetric.load5.toFixed(2) : '—', color: 'rgb(var(--chart-memory))' }, { label: '15m', value: latestChartMetric ? latestChartMetric.load15.toFixed(2) : '—', color: 'rgb(var(--chart-network-out))' }]} range={chartRanges.load} onRangeChange={(nextRange) => updateChartRange('load', nextRange, range, onRangeChange, setChartRanges)} series={[{ dataKey: 'load1', label: 'Load 1m', color: 'rgb(var(--chart-load))' }, { dataKey: 'load5', label: 'Load 5m', color: 'rgb(var(--chart-memory))' }, { dataKey: 'load15', label: 'Load 15m', color: 'rgb(var(--chart-network-out))' }]} />
          </div>
        </>
      ) : null}

      {activeSection === 'processes' ? (
        <section aria-label="进程 Top" className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border bg-surface p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-success">Process Snapshot</p>
              <h3 className="mt-1 text-lg font-black text-foreground">进程 Top</h3>
              <p className="mt-1 text-xs font-bold text-muted-foreground">采样时间：{formatUnixTime(processSnapshot?.collected_at)}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex rounded-2xl border border-border bg-card p-1 shadow-inner">
                {([
                  ['cpu', '按 CPU 排序'],
                  ['memory', '按内存排序'],
                  ['pid', '按 PID 排序'],
                  ['name', '按名称排序']
                ] as const).map(([sort, label]) => (
                  <button
                    key={sort}
                    type="button"
                    aria-pressed={processSort === sort}
                    onClick={() => setProcessSort(sort)}
                    className={`min-h-9 cursor-pointer rounded-xl px-3 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-primary/20 ${processSort === sort ? 'bg-slate-950 text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                aria-label="搜索进程"
                value={processSearch}
                onChange={(event) => setProcessSearch(event.target.value)}
                placeholder="搜索进程名、PID 或用户"
                className="min-h-10 rounded-2xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground focus:border-emerald-400 focus:ring-4 focus:ring-primary/20"
              />
            </div>
          </div>
          <MonitoringState loading={monitoringLoading} error={processSnapshot?.error} empty={!monitoringLoading && filteredProcesses.length === 0} emptyText={processSnapshot?.processes.length ? '当前筛选条件下没有进程。' : '暂无进程快照，等待 Agent 下一次上报。'} />
          {filteredProcesses.length > 0 ? <ProcessTable processes={filteredProcesses} /> : null}
        </section>
      ) : null}

      {activeSection === 'containers' ? (
        <section aria-label="Docker 容器" className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border bg-surface p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-500">Docker Snapshot</p>
              <h3 className="mt-1 text-lg font-black text-foreground">Docker 容器</h3>
              <p className="mt-1 text-xs font-bold text-muted-foreground">
                {dockerSnapshot?.available ? `Docker ${dockerSnapshot.version || '版本未知'} · ${formatUnixTime(dockerSnapshot.collected_at)}` : 'Docker 状态随 Agent 快照展示'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex rounded-2xl border border-border bg-card p-1 shadow-inner">
                {([
                  ['all', '全部'],
                  ['running', '运行中'],
                  ['stopped', '已停止'],
                  ['abnormal', '异常']
                ] as const).map(([filter, label]) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={dockerFilter === filter}
                    onClick={() => setDockerFilter(filter)}
                    className={`min-h-9 cursor-pointer rounded-xl px-3 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-cyan-100 ${dockerFilter === filter ? 'bg-slate-950 text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                aria-label="搜索容器"
                value={dockerSearch}
                onChange={(event) => setDockerSearch(event.target.value)}
                placeholder="搜索容器名、镜像或 ID"
                className="min-h-10 rounded-2xl border border-border bg-card px-4 text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
              />
              <button
                type="button"
                aria-label="刷新容器列表"
                onClick={() => node && onRefreshDocker?.(node.id)}
                disabled={!online}
                className="min-h-10 rounded-2xl border border-border bg-card px-4 text-xs font-black text-muted-foreground transition hover:text-foreground focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                ↻ 刷新
              </button>
              <button
                type="button"
                aria-label="创建容器"
                onClick={() => setCreateContainerModal(true)}
                disabled={!online}
                className="min-h-10 rounded-2xl border border-primary/30 bg-primary/10 px-4 text-xs font-black text-primary transition hover:bg-primary/15 focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                + 创建容器
              </button>
            </div>
          </div>
          {!dockerSnapshot?.available ? (
            <div className="m-4 rounded-2xl border border-dashed border-border bg-surface px-4 py-3 text-sm font-bold text-muted-foreground">
              {formatDockerUnavailableMessage(dockerSnapshot?.error, monitoringLoading)}
            </div>
          ) : null}
          {dockerSnapshot?.available ? <MonitoringState loading={monitoringLoading} error={dockerSnapshot.error} empty={!monitoringLoading && filteredContainers.length === 0} emptyText="当前筛选条件下没有容器。" /> : null}
          {dockerSnapshot?.available && filteredContainers.length > 0 ? (
            <DockerTable
              nodeID={node.id}
              containers={filteredContainers}
              onOpenLogs={(containerId, containerName) => {
                setContainerLogsModal({ open: true, containerId, containerName })
              }}
              onRefresh={async () => {
                if (onRefreshDocker) {
                  await onRefreshDocker(node.id)
                }
              }}
              onShowToast={(message, type) => {
                setToast({ message, type })
              }}
            />
          ) : null}
        </section>
      ) : null}

      {activeSection === 'files' ? (
        <section role="region" aria-label="文件管理" className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border bg-surface p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-success">File Manager</p>
              <h3 className="mt-1 text-lg font-black text-foreground">文件管理</h3>
              <p className="mt-1 text-xs font-bold text-muted-foreground">当前路径：{fileList?.path || '/'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="直接打开路径"
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openPath()
                }}
                className="min-h-10 w-48 rounded-2xl border border-border bg-card px-4 text-xs font-bold text-foreground outline-none placeholder:text-muted-foreground focus:border-emerald-400 focus:ring-4 focus:ring-primary/20"
              />
              <button type="button" onClick={openPath} className="min-h-10 rounded-2xl bg-success px-4 text-xs font-black text-white transition hover:brightness-95">打开路径</button>
              <input
                ref={uploadInputRef}
                type="file"
                aria-label="上传文件"
                onChange={(event) => {
                  uploadFile(event.target.files?.[0])
                  event.target.value = ''
                }}
                className="sr-only"
              />
              <button type="button" onClick={() => uploadInputRef.current?.click()} className="min-h-10 rounded-2xl border border-success/30 bg-card px-4 text-xs font-black text-success transition hover:bg-success/10">上传文件</button>
              <button type="button" onClick={() => loadFiles(parentPath(fileList?.path || '/'))} className="min-h-10 rounded-2xl border border-border bg-card px-4 text-xs font-black text-muted-foreground transition hover:text-foreground">返回上级</button>
              <button type="button" onClick={() => loadFiles(fileList?.path || '/')} className="min-h-10 rounded-2xl bg-success px-4 text-xs font-black text-white transition hover:brightness-95">刷新</button>
            </div>
          </div>
          {operationMessage && !editorOpen ? <p className="m-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-black text-warning">{operationMessage}</p> : null}
          {fileLoading ? <p className="m-4 rounded-2xl border border-info/30 bg-info/10 px-4 py-3 text-sm font-black text-info">正在加载目录...</p> : null}
          <div className="min-w-0">
            {(fileList?.entries ?? []).length === 0 && !fileLoading ? <p className="m-4 rounded-2xl border border-dashed border-border bg-surface px-4 py-3 text-sm font-bold text-muted-foreground">目录为空或暂无文件列表。</p> : null}
            <ul className="divide-y divide-border">
              {(fileList?.entries ?? []).map((entry) => (
                <li key={entry.path || entry.name} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface">
                  <div className="min-w-0">
                    <p className="truncate font-black text-foreground" title={entry.path}>{entry.name}</p>
                    <p className="mt-1 text-xs font-bold text-muted-foreground">{entry.type}{entry.size ? ` · ${formatBytes(entry.size)}` : ''}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {entry.type === 'directory' ? (
                      <button type="button" aria-label={`进入目录 ${entry.name}`} onClick={() => openFileEntry(entry)} className="rounded-2xl bg-success px-3 py-2 text-xs font-black text-white">进入</button>
                    ) : entry.type === 'binary' ? (
                      <span className="rounded-2xl bg-muted px-3 py-2 text-xs font-black text-muted-foreground">二进制文件不可编辑</span>
                    ) : (
                      <button type="button" aria-label={`编辑文件 ${entry.name}`} onClick={() => openFileEntry(entry)} className="rounded-2xl bg-success px-3 py-2 text-xs font-black text-white">编辑</button>
                    )}
                    <button type="button" aria-label={`删除 ${entry.name}`} onClick={() => deleteEntry(entry)} className="rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-black text-danger transition hover:bg-danger/15">删除</button>
                  </div>
                </li>
              ))}
            </ul>
            {fileList?.truncated ? <p className="border-t border-warning/30 bg-warning/10 px-4 py-2 text-xs font-bold text-warning">目录过大，仅显示前部分结果。</p> : null}
          </div>
        </section>
      ) : null}

      {activeSection === 'logs' ? (
        <section role="region" aria-label="日志查看" className="h-[600px] overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <div className="flex h-full flex-col p-4">
            <div className="mb-4">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-primary">Log Viewer</p>
              <h3 className="mt-1 text-lg font-black text-foreground">日志查看</h3>
              <p className="mt-1 text-xs font-bold text-muted-foreground">实时查看节点日志文件内容</p>
            </div>
            <div className="flex-1 overflow-hidden">
              {node ? <LogViewer nodeId={node.id} /> : null}
            </div>
          </div>
        </section>
      ) : null}

      {activeSection === 'agent' ? (
        <section role="region" aria-label="Agent 管理" className="overflow-hidden rounded-[28px] border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border bg-surface p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-success">Agent Management</p>
              <h3 className="mt-1 text-lg font-black text-foreground">Agent 管理</h3>
              <p className="mt-1 text-xs font-bold text-muted-foreground">单节点 Agent 状态、重启与最近日志。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadAgentManagement} disabled={!online || agentLoading} className="min-h-10 rounded-2xl border border-border bg-card px-4 text-xs font-black text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60">刷新状态</button>
              <button type="button" onClick={refreshAgentLogs} disabled={!online || agentLoading} className="min-h-10 rounded-2xl border border-success/30 bg-success/10 px-4 text-xs font-black text-success transition hover:bg-success/15 disabled:cursor-not-allowed disabled:opacity-60">刷新日志</button>
              <button type="button" aria-label="重启 Agent" onClick={restartAgentService} disabled={!online} className="min-h-10 rounded-2xl border border-warning/30 bg-warning/10 px-4 text-xs font-black text-warning transition hover:bg-warning/15 disabled:cursor-not-allowed disabled:opacity-60">重启 Agent</button>
              <button type="button" aria-label="卸载 Agent" title="通过 SSH 卸载远端 Agent" onClick={openSSHUninstallDialog} className="min-h-10 rounded-2xl border border-danger/30 bg-danger/10 px-4 text-xs font-black text-danger transition hover:bg-danger/15 focus:outline-none focus:ring-4 focus:ring-danger/20">卸载 Agent</button>
            </div>
          </div>
          {agentMessage ? <p className="m-4 rounded-2xl border border-success/30 bg-success/10 px-4 py-3 text-sm font-black text-success">{agentMessage}</p> : null}
          {agentError ? <p className="m-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-black text-warning">{agentError}</p> : null}
          {agentLoading ? <p className="m-4 rounded-2xl border border-info/30 bg-info/10 px-4 py-3 text-sm font-black text-info">正在加载 Agent 管理信息...</p> : null}
          <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <InfoBlock label="服务名称" value={agentStatus?.service_name || 'mizupanel-agent'} />
              <InfoBlock label="Agent 版本" value={agentStatus?.version || node.agent_version || '未知'} />
              <InfoBlock label="运行用户" value={agentStatus?.user || node.agent_user || '未知'} />
              <InfoBlock label="运行模式" value={formatAgentMode(agentStatus?.mode || node.agent_mode)} />
              <InfoBlock label="运行时间" value={formatUptime(agentStatus?.uptime)} />
              <InfoBlock label="配置路径" value={agentStatus?.config_path || '暂未上报'} wrap />
              <InfoBlock label="终端能力" value={agentStatus?.terminal_enabled ? '已启用' : '未启用'} />
              <InfoBlock label="Docker 能力" value={agentStatus?.docker_available ? '可用' : agentStatus?.docker_error || '不可用'} wrap />
            </div>
            <div className="min-w-0 rounded-2xl border border-border bg-slate-950 p-3 text-slate-100 shadow-inner">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Recent Logs · {agentLogs?.lines || 100} lines</p>
                <span className="text-xs font-bold text-slate-500">{formatUnixTime(agentLogs?.collected_at)}</span>
              </div>
              {agentLogs?.truncated ? <p className="mb-2 rounded-xl bg-warning/20 px-3 py-2 text-xs font-black text-warning">日志内容较长，已截断显示。</p> : null}
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-code px-3 py-3 font-mono text-xs font-semibold leading-5 text-code-foreground">{agentLogs?.content || '暂无 Agent 日志，点击刷新日志后查看。'}</pre>
            </div>
          </div>
        </section>
      ) : null}

      {sshUninstallOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
          <section role="dialog" aria-modal="true" aria-label="卸载 Agent" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[30px] border border-danger/30 bg-card shadow-2xl outline-none">
            <div className="flex items-start justify-between gap-3 border-b border-danger/30 bg-danger/10 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-danger">Root-only SSH</p>
                <h3 className="mt-1 font-display text-2xl font-black tracking-tight text-foreground">卸载 Agent</h3>
                <p className="mt-2 text-sm font-bold leading-6 text-danger">通过 SSH 登录 root，停止并删除目标机器上的 MizuPanel Agent。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={closeSSHUninstallDialog} className="shrink-0 rounded-2xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs font-black text-danger transition hover:bg-danger/10 focus:outline-none focus:ring-4 focus:ring-danger/20">✕</button>
            </div>
            <div className="grid gap-3 overflow-y-auto px-5 py-4 sm:grid-cols-2">
              <label className="text-xs font-black text-foreground">SSH Host<input aria-label="SSH Host" value={sshHost} onChange={(event) => setSSHHost(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-red-400 focus:ring-4 focus:ring-danger/20" /></label>
              <label className="text-xs font-black text-foreground">SSH 端口<input aria-label="SSH 端口" type="number" value={sshPort} onChange={(event) => setSSHPort(Number(event.target.value) || 22)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-red-400 focus:ring-4 focus:ring-danger/20" /></label>
              <label className="text-xs font-black text-foreground">SSH 用户<input aria-label="SSH 用户" value="root" readOnly className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-muted px-3 text-sm font-black text-muted-foreground" /></label>
              <label className="text-xs font-black text-foreground">认证方式<select aria-label="SSH 认证方式" value={sshAuthType} onChange={(event) => setSSHAuthType(event.target.value as SSHAuthType)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-red-400 focus:ring-4 focus:ring-danger/20"><option value="password">密码</option><option value="private_key">私钥</option></select></label>
              {sshAuthType === 'password' ? (
                <label className="text-xs font-black text-foreground sm:col-span-2">SSH 密码<input aria-label="SSH 密码" type="password" value={sshPassword} onChange={(event) => setSSHPassword(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-red-400 focus:ring-4 focus:ring-danger/20" /></label>
              ) : (
                <>
                  <label className="text-xs font-black text-foreground sm:col-span-2">SSH 私钥<textarea aria-label="SSH 私钥" value={sshPrivateKey} onChange={(event) => setSSHPrivateKey(event.target.value)} rows={4} className="mt-1 w-full rounded-2xl border border-border bg-card px-3 py-2 text-sm font-bold outline-none focus:border-red-400 focus:ring-4 focus:ring-danger/20" /></label>
                  <label className="text-xs font-black text-foreground sm:col-span-2">私钥 Passphrase（可选）<input aria-label="私钥 Passphrase" type="password" value={sshPassphrase} onChange={(event) => setSSHPassphrase(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-border bg-card px-3 text-sm font-bold text-foreground outline-none focus:border-red-400 focus:ring-4 focus:ring-danger/20" /></label>
                </>
              )}
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-bold leading-5 text-warning sm:col-span-2"><input type="checkbox" checked={sshRemoveRecord} onChange={(event) => setSSHRemoveRecord(event.target.checked)} className="mt-1 h-4 w-4" />卸载后同时移除面板节点记录和历史数据</label>
              {sshUninstallMessage ? <p className="rounded-2xl border border-success/30 bg-success/10 px-3 py-2 text-xs font-black text-success sm:col-span-2">{sshUninstallMessage}</p> : null}
              {sshUninstallError ? <p className="rounded-2xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-black text-danger sm:col-span-2">{sshUninstallError}</p> : null}
              {sshUninstallEvents.length > 0 ? (
                <div className="rounded-2xl border border-border bg-card p-3 shadow-inner sm:col-span-2">
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">卸载进度</p>
                  <ol className="space-y-2">
                    {sshUninstallEvents.map((event) => (
                      <li key={event.step} className="flex items-start gap-3 rounded-2xl bg-surface px-3 py-2">
                        <span className={`mt-0.5 h-3 w-3 rounded-full ${event.status === 'success' ? 'bg-success' : event.status === 'failed' ? 'bg-danger' : event.status === 'running' ? 'bg-info/100' : 'bg-slate-400'}`} />
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
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-surface px-5 py-4">
              {sshUninstallMessage || (sshUninstallEvents.length > 0 && sshUninstallEvents.every((e) => e.status === 'success' || e.status === 'failed')) ? (
                <button type="button" onClick={closeSSHUninstallDialog} className="min-h-11 cursor-pointer rounded-2xl bg-card px-4 text-sm font-black text-foreground shadow-sm transition hover:bg-muted focus:outline-none focus:ring-4 focus:ring-primary/20">
                  关闭
                </button>
              ) : (
                <>
                  <button type="button" onClick={closeSSHUninstallDialog} disabled={sshUninstallLoading} className="min-h-11 cursor-pointer rounded-2xl border border-border bg-card px-4 text-sm font-black text-muted-foreground transition hover:border-success/50 hover:text-foreground focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60">取消</button>
                  <button type="button" onClick={startSSHUninstall} disabled={sshUninstallLoading} className="min-h-11 cursor-pointer rounded-2xl bg-danger px-4 text-sm font-black text-white shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-danger/20 disabled:cursor-not-allowed disabled:opacity-50">{sshUninstallLoading ? '正在创建卸载任务...' : '开始 SSH 卸载'}</button>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {editorOpen && fileRead?.editable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
          <div role="dialog" aria-modal="true" aria-label="编辑文件" className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-[28px] border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div className="min-w-0">
                <p className="text-xs font-black text-muted-foreground">正在编辑</p>
                <p className="mt-1 break-all text-sm font-black text-foreground">{fileRead.path}</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setEditorOpen(false)} className="shrink-0 rounded-2xl border border-border bg-card px-3 py-2 text-xs font-black text-muted-foreground transition hover:text-foreground">关闭</button>
            </div>
            {operationMessage ? <p className="mt-3 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-black text-warning">{operationMessage}</p> : null}
            <textarea autoFocus aria-label="文件内容" value={fileContent} onChange={(event) => setFileContent(event.target.value)} className="mt-3 min-h-[56vh] w-full resize-y rounded-2xl border border-border bg-slate-950 p-4 font-mono text-sm font-semibold leading-6 text-slate-100 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-primary/20" />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={saveFile} className="min-h-11 rounded-2xl bg-success px-4 text-sm font-black text-white shadow-sm transition hover:brightness-95">保存文件</button>
              <button type="button" onClick={() => setEditorOpen(false)} className="min-h-11 rounded-2xl border border-border bg-card px-4 text-sm font-black text-muted-foreground transition hover:text-foreground">关闭编辑器</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Container Logs Modal */}
      {node && (
        <ContainerLogsModal
          nodeId={node.id}
          containerId={containerLogsModal.containerId}
          containerName={containerLogsModal.containerName}
          open={containerLogsModal.open}
          onClose={() => setContainerLogsModal({ open: false, containerId: '', containerName: '' })}
        />
      )}

      <CreateContainerModal
        open={createContainerModal}
        nodeId={node.id}
        onClose={() => setCreateContainerModal(false)}
        onCreate={handleCreateContainer}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </section>
  )
}

function filterMetricsByChartRange(metrics: Metric[], range: ChartRange) {
  if (range === '6h' || metrics.length === 0) return metrics
  const timestamps = metrics.map((metric) => new Date(metric.created_at).getTime()).filter((time) => Number.isFinite(time))
  if (timestamps.length === 0) return metrics
  const latest = Math.max(...timestamps)
  const cutoff = latest - 60 * 60 * 1000
  return metrics.filter((metric) => {
    const time = new Date(metric.created_at).getTime()
    return Number.isFinite(time) && time >= cutoff
  })
}

function updateChartRange(chartKey: string, nextRange: ChartRange, currentRange: RangeOption, onRangeChange: (range: RangeOption) => void, setChartRanges: (updater: (current: Record<string, ChartRange>) => Record<string, ChartRange>) => void) {
  setChartRanges((current) => ({ ...current, [chartKey]: nextRange }))
  if (nextRange === '6h' && currentRange !== '6h') onRangeChange('6h')
}

function mergeMetricFallback(primary?: Metric, fallback?: Metric): Metric | undefined {
  if (!primary) return fallback
  if (!fallback) return primary
  const uptimeSource = hasPositiveNumber(primary.uptime) ? primary : hasPositiveNumber(fallback.uptime) ? fallback : undefined
  return {
    ...fallback,
    ...primary,
    uptime: uptimeSource?.uptime,
    created_at: uptimeSource?.created_at || primary.created_at,
    disk_read_speed: finiteOrUndefined(primary.disk_read_speed, fallback.disk_read_speed),
    disk_write_speed: finiteOrUndefined(primary.disk_write_speed, fallback.disk_write_speed),
    rx_speed: finiteOrFallback(primary.rx_speed, fallback.rx_speed),
    tx_speed: finiteOrFallback(primary.tx_speed, fallback.tx_speed),
    load1: finiteOrFallback(primary.load1, fallback.load1),
    load5: finiteOrFallback(primary.load5, fallback.load5),
    load15: finiteOrFallback(primary.load15, fallback.load15)
  }
}

function finiteOrUndefined(primary: number | undefined, fallback: number | undefined) {
  if (typeof primary === 'number' && Number.isFinite(primary)) return primary
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback
  return undefined
}

function finiteOrFallback(primary: number | undefined, fallback: number | undefined) {
  return finiteOrUndefined(primary, fallback) ?? 0
}

function hasPositiveNumber(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function formatLoadSummary(metric?: Metric) {
  if (!metric) return '1m — · 5m — · 15m —'
  const load1 = Number.isFinite(metric.load1) ? metric.load1.toFixed(2) : '—'
  const load5 = Number.isFinite(metric.load5) ? metric.load5.toFixed(2) : '—'
  const load15 = Number.isFinite(metric.load15) ? metric.load15.toFixed(2) : '—'
  return `1m ${load1} · 5m ${load5} · 15m ${load15}`
}

function formatAgentMode(mode?: string) {
  if (mode === 'ops') return '运维模式'
  if (mode === 'normal') return '普通模式'
  return mode || '未知'
}

function formatUptime(seconds?: number) {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return '暂未上报'
  if (seconds < 60) return '< 1 分钟'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

function formatBootTime(metric?: Metric) {
  if (!metric) return '暂未上报'
  const uptime = metric.uptime
  if (typeof uptime !== 'number' || !Number.isFinite(uptime) || uptime <= 0) return '暂未上报'
  const sampledAt = new Date(metric.created_at).getTime()
  if (!Number.isFinite(sampledAt)) return '暂未上报'
  return new Date(sampledAt - uptime * 1000).toLocaleString('zh-CN', { hour12: false })
}

function InfoBlock({ label, value, wrap = false }: { label: string, value: string, wrap?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={`mt-2 text-sm font-black text-foreground ${wrap ? 'leading-5' : 'truncate'}`} title={value}>{value}</p>
    </div>
  )
}

function openTerminalPage(nodeID: string) {
  window.open(`/nodes/${encodeURIComponent(nodeID)}/terminal`, '_blank', 'noopener,noreferrer')
}

function openContainerExecPage(nodeID: string, containerID: string) {
  window.open(`/nodes/${encodeURIComponent(nodeID)}/containers/${encodeURIComponent(containerID)}/exec`, '_blank', 'noopener,noreferrer')
}

function TerminalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.75 5.75h14.5a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5v-9.5a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="m7.5 9 2.5 2.5L7.5 14" />
      <path d="M12.5 14h4" />
    </svg>
  )
}

function LogIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.75 5.75h14.5a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5v-9.5a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M7.5 8.5h9" />
      <path d="M7.5 12h9" />
      <path d="M7.5 15.5h5" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.75 4.75h5.5l2 2h7a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H4.75a1.5 1.5 0 0 1-1.5-1.5V6.25a1.5 1.5 0 0 1 1.5-1.5Z" />
    </svg>
  )
}

function PowerIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.75v8" />
      <path d="M7.25 6.75a7 7 0 1 0 9.5 0" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 7h14" />
      <path d="M9 7V5.75A1.75 1.75 0 0 1 10.75 4h2.5A1.75 1.75 0 0 1 15 5.75V7" />
      <path d="M18 7l-.75 11.25A1.75 1.75 0 0 1 15.5 20h-7a1.75 1.75 0 0 1-1.75-1.75L6 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  )
}

function parentPath(path: string) {
  if (!path || path === '/') return '/'
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

function joinRemotePath(directory: string, name: string) {
  const safeName = name.replace(/^\/+/, '')
  if (!directory || directory === '/') return `/${safeName}`
  return `${directory.replace(/\/+$/, '')}/${safeName}`
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function formatOperationError(code: string | undefined, fallback: string) {
  if (code === 'permission_denied') return '权限不足：当前 Agent 运行用户无权执行该操作。如需使用该能力，请使用运维模式重新安装 Agent，或在目标机器上调整 Agent 用户权限。'
  if (code === 'binary_file') return '二进制文件不可编辑'
  if (code === 'too_large') return fallback.includes('上传') ? '文件过大，暂不支持上传。' : '文件过大，暂不支持在线编辑。'
  if (code === 'directory_not_empty') return '目录非空，暂不支持直接删除。'
  if (code === 'timeout') return fallback
  if (code === 'offline') return '节点离线，无法发送文件管理或重启命令。'
  return fallback
}

function formatDockerUnavailableMessage(error: string | undefined, loading: boolean) {
  if (loading) return '正在检测 Docker...'
  if (!error) return '未检测到 Docker 或暂无 Docker 快照。'
  if (error.includes('permission denied') && error.includes('/var/run/docker.sock')) {
    return 'Agent 当前用户没有权限访问 Docker。请把 Agent 运行用户加入 docker 组，或用有 Docker socket 权限的用户运行 Agent。'
  }
  if (error.includes('/var/run/docker.sock')) {
    return `Docker 当前不可用：${error}`
  }
  return error
}

function MonitoringState({ loading, error, empty, emptyText }: { loading: boolean, error?: string, empty: boolean, emptyText: string }) {
  if (loading) {
    return <div className="m-4 rounded-2xl border border-info/30 bg-info/10 px-4 py-3 text-sm font-black text-info">正在加载进程 / Docker 快照...</div>
  }
  if (error) {
    return <div className="m-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-black text-warning">采集提示：{error}</div>
  }
  if (empty) {
    return <div className="m-4 rounded-2xl border border-dashed border-border bg-surface px-4 py-3 text-sm font-bold text-muted-foreground">{emptyText}</div>
  }
  return null
}

function ProcessTable({ processes }: { processes: ProcessInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-card text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
          <tr>
            <th className="px-4 py-3">PID</th>
            <th className="px-4 py-3">名称</th>
            <th className="px-4 py-3">用户</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">CPU</th>
            <th className="px-4 py-3">内存</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {processes.map((process) => (
            <tr key={`${process.pid}-${process.name}`} className="align-top hover:bg-surface">
              <td className="px-4 py-3 font-mono text-xs font-black text-foreground">{process.pid}</td>
              <td className="px-4 py-3 font-black text-foreground">{process.name || 'unknown'}</td>
              <td className="px-4 py-3 font-semibold text-muted-foreground">{process.user || '—'}</td>
              <td className="px-4 py-3"><StatusPill value={process.status} /></td>
              <td className="px-4 py-3 font-black text-success">{formatPercent(process.cpu_usage)}</td>
              <td className="px-4 py-3 font-semibold text-foreground">{formatBytes(process.memory_rss)} <span className="text-muted-foreground">({formatPercent(process.memory_usage)})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DockerTable({ nodeID, containers, onOpenLogs, onRefresh, onShowToast }: { nodeID: string; containers: DockerContainer[]; onOpenLogs: (containerId: string, containerName: string) => void; onRefresh: () => void; onShowToast: (message: string, type: 'success' | 'error') => void }) {
  return (
    <div data-testid="docker-table-scroll" className="min-w-0 max-w-full overflow-x-auto">
      <table className="w-full min-w-0 table-fixed divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-card text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground">
          <tr>
            <th className="w-[20%] px-4 py-3">容器</th>
            <th className="w-[20%] px-4 py-3">镜像</th>
            <th className="w-[14%] px-4 py-3">状态</th>
            <th className="w-[8%] px-4 py-3">CPU</th>
            <th className="w-[14%] px-4 py-3">内存</th>
            <th className="hidden w-[14%] px-4 py-3 2xl:table-cell">网络</th>
            <th className="hidden w-[12%] px-4 py-3 2xl:table-cell">创建时间</th>
            <th className="w-[10%] px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {containers.map((container) => {
            const running = container.state.toLowerCase() === 'running'
            const execID = container.full_id || container.id
            return (
              <tr key={container.id} className="align-top hover:bg-surface">
                <td className="min-w-0 px-4 py-3"><p className="truncate font-black text-foreground" title={container.name || container.id}>{container.name || container.id}</p><p className="break-all font-mono text-xs font-bold text-muted-foreground" title={container.full_id || container.id}>{container.id}</p></td>
                <td className="min-w-0 px-4 py-3 font-semibold text-muted-foreground"><p className="line-clamp-2 break-all" title={container.image || '—'}>{container.image || '—'}</p></td>
                <td className="min-w-0 px-4 py-3">
                  <div className="truncate">
                    <StatusPill value={container.state || 'unknown'} detail={container.status} />
                  </div>
                </td>
                <td className="px-4 py-3 font-black text-cyan-600">{formatPercent(container.cpu_usage ?? 0)}</td>
                <td className="min-w-0 px-4 py-3 font-semibold text-foreground"><p className="line-clamp-2 break-words" title={`${formatBytes(container.memory_usage ?? 0)}${container.memory_limit ? ` / ${formatBytes(container.memory_limit)} (${formatPercent(container.memory_percent ?? 0)})` : ''}`}>{formatBytes(container.memory_usage ?? 0)}{container.memory_limit ? <span className="text-muted-foreground"> / {formatBytes(container.memory_limit)} ({formatPercent(container.memory_percent ?? 0)})</span> : null}</p></td>
                <td className="hidden min-w-0 px-4 py-3 font-semibold text-muted-foreground 2xl:table-cell"><p className="truncate">↓ {formatBytes(container.network_rx ?? 0)} · ↑ {formatBytes(container.network_tx ?? 0)}</p></td>
                <td className="hidden px-4 py-3 font-semibold text-muted-foreground 2xl:table-cell">{formatUnixTime(container.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center">
                    <ContainerActionsDropdown
                      container={container}
                      nodeID={nodeID}
                      onRefresh={onRefresh}
                      onShowToast={onShowToast}
                      onOpenLogs={onOpenLogs}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusPill({ value, detail }: { value: string, detail?: string }) {
  const normalized = value.toLowerCase()
  const className = normalized.includes('run')
    ? 'bg-success/10 text-success ring-success/20'
    : normalized.includes('exit') || normalized.includes('stop')
      ? 'bg-muted text-muted-foreground ring-slate-200'
      : normalized.includes('restart') || normalized.includes('zombie')
        ? 'bg-warning/10 text-warning ring-warning/20'
        : 'bg-info/10 text-info ring-info/20'
  return (
    <span className={`inline-flex w-full flex-col rounded-2xl px-3 py-1 text-xs font-black ring-1 ${className}`}>
      <span>{value || 'unknown'}</span>
      {detail ? <span className="mt-0.5 truncate font-semibold opacity-75">{detail}</span> : null}
    </span>
  )
}

function ContainerActionsDropdown({ container, nodeID, onRefresh, onShowToast, onOpenLogs }: { container: DockerContainer; nodeID: string; onRefresh: () => void; onShowToast: (message: string, type: 'success' | 'error') => void; onOpenLogs: (containerId: string, containerName: string) => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const running = container.state.toLowerCase() === 'running'
  const execID = container.full_id || container.id

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as HTMLElement)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'delete' | 'exec' | 'logs') => {
    setOpen(false)

    // Handle non-API actions
    if (action === 'exec') {
      openContainerExecPage(nodeID, execID)
      return
    }

    if (action === 'logs') {
      onOpenLogs(execID, container.name || container.id)
      return
    }

    setLoading(true)

    const actionText = action === 'start' ? '启动' : action === 'stop' ? '停止' : action === 'restart' ? '重启' : '删除'

    try {
      const containerID = container.full_id || container.id
      let response: Response

      if (action === 'delete') {
        response = await fetch(`/api/nodes/${nodeID}/containers/${containerID}?force=true`, {
          method: 'DELETE',
        })
      } else {
        response = await fetch(`/api/nodes/${nodeID}/containers/${containerID}/${action}`, {
          method: 'POST',
        })
      }

      const result = await response.json()

      if (result.success) {
        onShowToast(`容器${actionText}成功`, 'success')
        // Refresh docker snapshot
        onRefresh()
      } else {
        onShowToast(`容器${actionText}失败: ${result.error || '未知错误'}`, 'error')
      }
    } catch (err) {
      onShowToast(`容器${actionText}失败: ${err instanceof Error ? err.message : '网络错误'}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        aria-label="容器操作"
        title="容器操作"
        onClick={() => setOpen(!open)}
        disabled={loading}
        className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-2xl border border-border bg-card text-foreground transition hover:-translate-y-0.5 hover:bg-surface focus:outline-none focus:ring-4 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="3" r="1" fill="currentColor" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
          <circle cx="8" cy="13" r="1" fill="currentColor" />
        </svg>
      </button>
      {open && !loading && (
        <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-xl border border-border bg-card py-1 shadow-lg">
          <button
            type="button"
            onClick={() => handleAction('exec')}
            disabled={!running}
            className="w-full px-4 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-surface disabled:cursor-not-allowed disabled:text-muted-foreground"
          >
            进入容器
          </button>
          <button
            type="button"
            onClick={() => handleAction('logs')}
            className="w-full px-4 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-surface"
          >
            查看日志
          </button>
          <div className="my-1 border-t border-border" />
          {!running && (
            <button
              type="button"
              onClick={() => handleAction('start')}
              className="w-full px-4 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-surface"
            >
              启动
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={() => handleAction('stop')}
              className="w-full px-4 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-surface"
            >
              停止
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={() => handleAction('restart')}
              className="w-full px-4 py-2 text-left text-sm font-semibold text-foreground transition hover:bg-surface"
            >
              重启
            </button>
          )}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => handleAction('delete')}
            className="w-full px-4 py-2 text-left text-sm font-semibold text-danger transition hover:bg-surface"
          >
            删除
          </button>
        </div>
      )}
    </div>
  )
}

function compareProcesses(left: ProcessInfo, right: ProcessInfo, sort: ProcessSort) {
  if (sort === 'memory') return right.memory_rss - left.memory_rss || left.pid - right.pid
  if (sort === 'pid') return left.pid - right.pid
  if (sort === 'name') return left.name.localeCompare(right.name) || left.pid - right.pid
  return right.cpu_usage - left.cpu_usage || left.pid - right.pid
}

function dockerFilterFor(container: DockerContainer): DockerFilter {
  const state = container.state.toLowerCase()
  if (state === 'running') return 'running'
  if (state === 'exited' || state === 'dead' || state === 'created') return 'stopped'
  if (state === 'restarting' || state === 'removing' || state === 'paused') return 'abnormal'
  return 'abnormal'
}

function formatUnixTime(value?: number) {
  if (!value) return '暂无快照'
  return new Date(value * 1000).toLocaleString('zh-CN', { hour12: false })
}

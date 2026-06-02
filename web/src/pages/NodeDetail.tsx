import { useMemo, useRef, useState } from 'react'

import type { DockerContainer, DockerSnapshotResponse, FileDeleteResponse, FileEntry, FileListResponse, FileReadResponse, FileUploadResponse, FileWriteResponse, Metric, Node, ProcessInfo, ProcessSnapshotResponse, RangeOption, RebootResponse, SSHAuthType, SSHJobResponse, SSHProgressEvent, SSHUninstallRequest } from '../types'
import { formatBytes, formatPercent, formatSpeed } from '../lib/format'
import { MetricCard } from '../components/MetricCard'
import { MetricsChart } from '../components/MetricsChart'

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
  onDeleteNode?: (nodeID: string) => Promise<void>
  onSSHUninstall?: (nodeID: string, request: SSHUninstallRequest) => Promise<SSHJobResponse>
}

type DetailSection = 'overview' | 'processes' | 'containers' | 'files'
type ProcessSort = 'cpu' | 'memory' | 'pid' | 'name'
type DockerFilter = 'all' | 'running' | 'stopped' | 'abnormal'
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

export function NodeDetail({ node, metrics, processSnapshot, dockerSnapshot, monitoringLoading = false, range, onRangeChange, onLoadFiles, onReadFile, onWriteFile, onUploadFile, onDeletePath, onRebootNode, onDeleteNode, onSSHUninstall }: NodeDetailProps) {
  const [activeSection, setActiveSection] = useState<DetailSection>('overview')
  const [processSort, setProcessSort] = useState<ProcessSort>('cpu')
  const [processSearch, setProcessSearch] = useState('')
  const [dockerFilter, setDockerFilter] = useState<DockerFilter>('all')
  const [dockerSearch, setDockerSearch] = useState('')
  const [fileList, setFileList] = useState<FileListResponse>()
  const [fileRead, setFileRead] = useState<FileReadResponse>()
  const [fileContent, setFileContent] = useState('')
  const [pathInput, setPathInput] = useState('/')
  const [editorOpen, setEditorOpen] = useState(false)
  const fileRequestSeq = useRef(0)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [operationMessage, setOperationMessage] = useState<string>()
  const [fileLoading, setFileLoading] = useState(false)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [removeLoading, setRemoveLoading] = useState(false)
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

  const deleteNodeRecord = () => {
    if (!onDeleteNode || removeLoading) return
    setRemoveLoading(true)
    setOperationMessage(undefined)
    onDeleteNode(node.id)
      .then(() => {
        setRemoveDialogOpen(false)
        setOperationMessage('节点记录已移除。')
      })
      .catch((err: unknown) => setOperationMessage(err instanceof Error ? err.message : '节点记录移除失败'))
      .finally(() => setRemoveLoading(false))
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

  return (
    <section className="min-w-0 space-y-3">
      <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-emerald-600">节点详情</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <h2 className="truncate font-display text-3xl font-black tracking-tight text-slate-950">{displayName}</h2>
              <button
                type="button"
                aria-label="打开终端"
                title={node.terminal_enabled ? '打开终端' : '该节点未启用终端'}
                disabled={!node.terminal_enabled}
                onClick={() => openTerminalPage(node.id)}
                className="group inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-500 text-white shadow-sm transition hover:-translate-y-0.5 hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 disabled:shadow-none disabled:hover:translate-y-0"
              >
                <TerminalIcon />
              </button>
              <button
                type="button"
                aria-label="文件"
                title="文件管理"
                disabled={!online}
                onClick={() => loadFiles(fileList?.path || '/')}
                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-white text-emerald-600 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 disabled:hover:translate-y-0"
              >
                <FileIcon />
              </button>
              <button
                type="button"
                aria-label="重启"
                title="重启节点"
                disabled={!online}
                onClick={reboot}
                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 disabled:hover:translate-y-0"
              >
                <PowerIcon />
              </button>
              <button
                type="button"
                aria-label="移除节点记录"
                title="从面板移除节点记录"
                onClick={() => setRemoveDialogOpen(true)}
                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl border border-red-200 bg-white text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-100"
              >
                <TrashIcon />
              </button>
              <button
                type="button"
                aria-label="SSH 卸载 Agent"
                title="通过 SSH 卸载远端 Agent"
                onClick={openSSHUninstallDialog}
                className="min-h-11 shrink-0 cursor-pointer rounded-2xl border border-red-200 bg-red-50 px-3 text-xs font-black text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-100"
              >
                SSH 卸载 Agent
              </button>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {node.hostname || '未知主机'} · {node.ip || '未知 IP'} · {node.os}/{node.arch} · 内核 {node.kernel || '未知'}
            </p>
            <p className="mt-1 text-xs font-black text-slate-500">{agentModeLabel} · {agentUserLabel}</p>
          </div>
          <div className="flex w-fit rounded-2xl border border-slate-200 bg-slate-50 p-1">
            {(['1h', '6h'] as RangeOption[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onRangeChange(option)}
                className={`min-h-10 cursor-pointer rounded-xl px-4 text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${
                  range === option ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-950'
                }`}
              >
                {option === '1h' ? '1 小时' : '6 小时'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {operationMessage && activeSection !== 'files' ? <p className="rounded-[28px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">{operationMessage}</p> : null}

      <div className="flex flex-wrap gap-2 rounded-[28px] border border-slate-200 bg-white p-2 shadow-sm" role="group" aria-label="节点详情视图">
        {([
          ['overview', '机器基本信息'],
          ['processes', '进程信息'],
          ['containers', '容器信息'],
          ['files', '文件管理']
        ] as const).map(([section, label]) => (
          <button
            key={section}
            type="button"
            aria-pressed={activeSection === section}
            onClick={() => section === 'files' ? loadFiles(fileList?.path || '/') : setActiveSection(section)}
            className={`min-h-11 cursor-pointer rounded-2xl px-4 text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${activeSection === section ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSection === 'overview' ? (
        <>
          <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">概览</p>
                <h3 className="mt-1 text-lg font-black text-slate-950">硬件概览</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">最新采样</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="CPU" value={metric ? formatPercent(metric.cpu_usage) : '—'} detail={metric ? `${metric.cpu_cores} 核` : '等待 Agent'} />
              <MetricCard label="内存" value={metric ? formatPercent(metric.memory_usage) : '—'} tone="green" detail={metric ? `${formatBytes(metric.memory_used)} / ${formatBytes(metric.memory_total)}` : '等待 Agent'} />
              <MetricCard label="磁盘" value={metric ? formatPercent(metric.disk_usage) : '—'} tone="amber" detail={metric ? `${formatBytes(metric.disk_used)} / ${formatBytes(metric.disk_total)}` : '等待 Agent'} />
              <MetricCard label="网络" value={metric ? formatSpeed(metric.rx_speed) : '—'} tone="slate" detail={metric ? `上行 ${formatSpeed(metric.tx_speed)}` : '等待 Agent'} />
            </div>
          </section>

          <div className="grid gap-3 xl:grid-cols-2">
            <MetricsChart metrics={metrics} dataKey="cpu_usage" title="负载趋势" color="rgb(var(--chart-cpu))" />
            <MetricsChart metrics={metrics} dataKey="memory_usage" title="内存曲线" color="rgb(var(--chart-memory))" />
            <MetricsChart metrics={metrics} dataKey="disk_usage" title="磁盘曲线" color="rgb(var(--chart-disk))" />
            <MetricsChart metrics={metrics} dataKey="rx_speed" title="网络速率" color="rgb(var(--chart-network-in))" unitLabel="bytes/s" domain={[0, 'auto']} />
          </div>
        </>
      ) : null}

      {activeSection === 'processes' ? (
        <section aria-label="进程 Top" className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-600">Process Snapshot</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">进程 Top</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">采样时间：{formatUnixTime(processSnapshot?.collected_at)}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex rounded-2xl border border-slate-200 bg-white p-1 shadow-inner">
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
                    className={`min-h-9 cursor-pointer rounded-xl px-3 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-emerald-100 ${processSort === sort ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'}`}
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
                className="min-h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-500 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              />
            </div>
          </div>
          <MonitoringState loading={monitoringLoading} error={processSnapshot?.error} empty={!monitoringLoading && filteredProcesses.length === 0} emptyText={processSnapshot?.processes.length ? '当前筛选条件下没有进程。' : '暂无进程快照，等待 Agent 下一次上报。'} />
          {filteredProcesses.length > 0 ? <ProcessTable processes={filteredProcesses} /> : null}
        </section>
      ) : null}

      {activeSection === 'containers' ? (
        <section aria-label="Docker 容器" className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-500">Docker Snapshot</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">Docker 容器</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">
                {dockerSnapshot?.available ? `Docker ${dockerSnapshot.version || '版本未知'} · ${formatUnixTime(dockerSnapshot.collected_at)}` : 'Docker 状态随 Agent 快照展示'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex rounded-2xl border border-slate-200 bg-white p-1 shadow-inner">
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
                    className={`min-h-9 cursor-pointer rounded-xl px-3 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-cyan-100 ${dockerFilter === filter ? 'bg-slate-950 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'}`}
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
                className="min-h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-950 outline-none placeholder:text-slate-500 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
              />
            </div>
          </div>
          {!dockerSnapshot?.available ? (
            <div className="m-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
              {formatDockerUnavailableMessage(dockerSnapshot?.error, monitoringLoading)}
            </div>
          ) : null}
          {dockerSnapshot?.available ? <MonitoringState loading={monitoringLoading} error={dockerSnapshot.error} empty={!monitoringLoading && filteredContainers.length === 0} emptyText="当前筛选条件下没有容器。" /> : null}
          {dockerSnapshot?.available && filteredContainers.length > 0 ? <DockerTable nodeID={node.id} containers={filteredContainers} /> : null}
        </section>
      ) : null}

      {activeSection === 'files' ? (
        <section role="region" aria-label="文件管理" className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-emerald-600">File Manager</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">文件管理</h3>
              <p className="mt-1 text-xs font-bold text-slate-500">当前路径：{fileList?.path || '/'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="直接打开路径"
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openPath()
                }}
                className="min-h-10 w-48 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-950 outline-none placeholder:text-slate-500 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
              />
              <button type="button" onClick={openPath} className="min-h-10 rounded-2xl bg-emerald-500 px-4 text-xs font-black text-white transition hover:brightness-95">打开路径</button>
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
              <button type="button" onClick={() => uploadInputRef.current?.click()} className="min-h-10 rounded-2xl border border-emerald-200 bg-white px-4 text-xs font-black text-emerald-600 transition hover:bg-emerald-50">上传文件</button>
              <button type="button" onClick={() => loadFiles(parentPath(fileList?.path || '/'))} className="min-h-10 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-500 transition hover:text-slate-950">返回上级</button>
              <button type="button" onClick={() => loadFiles(fileList?.path || '/')} className="min-h-10 rounded-2xl bg-emerald-500 px-4 text-xs font-black text-white transition hover:brightness-95">刷新</button>
            </div>
          </div>
          {operationMessage && !editorOpen ? <p className="m-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">{operationMessage}</p> : null}
          {fileLoading ? <p className="m-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-black text-sky-700">正在加载目录...</p> : null}
          <div className="min-w-0">
            {(fileList?.entries ?? []).length === 0 && !fileLoading ? <p className="m-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">目录为空或暂无文件列表。</p> : null}
            <ul className="divide-y divide-slate-100">
              {(fileList?.entries ?? []).map((entry) => (
                <li key={entry.path || entry.name} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                  <div className="min-w-0">
                    <p className="truncate font-black text-slate-950" title={entry.path}>{entry.name}</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">{entry.type}{entry.size ? ` · ${formatBytes(entry.size)}` : ''}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    {entry.type === 'directory' ? (
                      <button type="button" aria-label={`进入目录 ${entry.name}`} onClick={() => openFileEntry(entry)} className="rounded-2xl bg-emerald-500 px-3 py-2 text-xs font-black text-white">进入</button>
                    ) : entry.type === 'binary' ? (
                      <span className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-500">二进制文件不可编辑</span>
                    ) : (
                      <button type="button" aria-label={`编辑文件 ${entry.name}`} onClick={() => openFileEntry(entry)} className="rounded-2xl bg-emerald-500 px-3 py-2 text-xs font-black text-white">编辑</button>
                    )}
                    <button type="button" aria-label={`删除 ${entry.name}`} onClick={() => deleteEntry(entry)} className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 transition hover:bg-red-100">删除</button>
                  </div>
                </li>
              ))}
            </ul>
            {fileList?.truncated ? <p className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">目录过大，仅显示前部分结果。</p> : null}
          </div>
        </section>
      ) : null}

      {removeDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="移除节点记录"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !removeLoading) setRemoveDialogOpen(false)
            }}
            className="w-full max-w-xl overflow-hidden rounded-[30px] border border-red-200 bg-white shadow-2xl outline-none"
          >
            <div className="border-b border-red-200 bg-red-50 px-5 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-700">Danger Zone</p>
              <h3 className="mt-1 font-display text-2xl font-black tracking-tight text-slate-950">移除节点记录</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-red-700">确认从 MizuPanel 面板中移除 {displayName}？</p>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm font-bold leading-6 text-slate-500">
              <p>这只会删除 MizuPanel 里的节点记录和历史指标，不会停止目标机器上的 Agent。</p>
              <p>这也不会卸载目标机器上的 Agent。如果 Agent 仍在运行，可能会重新连接并再次出现。</p>
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">建议先按 README 中的卸载命令卸载 Agent，再移除面板记录。</p>
              {operationMessage ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">{operationMessage}</p> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button type="button" onClick={() => setRemoveDialogOpen(false)} disabled={removeLoading} className="min-h-11 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-500 transition hover:border-emerald-300 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">取消</button>
              <button type="button" onClick={deleteNodeRecord} disabled={removeLoading} className="min-h-11 cursor-pointer rounded-2xl bg-red-600 px-4 text-sm font-black text-white shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-50">
                {removeLoading ? '正在移除...' : '确认移除'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {sshUninstallOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
          <section role="dialog" aria-modal="true" aria-label="SSH 卸载 Agent" className="w-full max-w-2xl overflow-hidden rounded-[30px] border border-red-200 bg-white shadow-2xl outline-none">
            <div className="border-b border-red-200 bg-red-50 px-5 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-700">Root-only SSH</p>
              <h3 className="mt-1 font-display text-2xl font-black tracking-tight text-slate-950">SSH 卸载 Agent</h3>
              <p className="mt-2 text-sm font-bold leading-6 text-red-700">通过 SSH 登录 root，停止并删除目标机器上的 MizuPanel Agent。</p>
            </div>
            <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
              <label className="text-xs font-black text-slate-950">SSH Host<input aria-label="SSH Host" value={sshHost} onChange={(event) => setSSHHost(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100" /></label>
              <label className="text-xs font-black text-slate-950">SSH 端口<input aria-label="SSH 端口" type="number" value={sshPort} onChange={(event) => setSSHPort(Number(event.target.value) || 22)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100" /></label>
              <label className="text-xs font-black text-slate-950">SSH 用户<input aria-label="SSH 用户" value="root" readOnly className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-slate-100 px-3 text-sm font-black text-slate-500" /></label>
              <label className="text-xs font-black text-slate-950">认证方式<select aria-label="SSH 认证方式" value={sshAuthType} onChange={(event) => setSSHAuthType(event.target.value as SSHAuthType)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100"><option value="password">密码</option><option value="private_key">私钥</option></select></label>
              {sshAuthType === 'password' ? (
                <label className="text-xs font-black text-slate-950 sm:col-span-2">SSH 密码<input aria-label="SSH 密码" type="password" value={sshPassword} onChange={(event) => setSSHPassword(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100" /></label>
              ) : (
                <>
                  <label className="text-xs font-black text-slate-950 sm:col-span-2">SSH 私钥<textarea aria-label="SSH 私钥" value={sshPrivateKey} onChange={(event) => setSSHPrivateKey(event.target.value)} rows={4} className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100" /></label>
                  <label className="text-xs font-black text-slate-950 sm:col-span-2">私钥 Passphrase（可选）<input aria-label="私钥 Passphrase" type="password" value={sshPassphrase} onChange={(event) => setSSHPassphrase(event.target.value)} className="mt-1 min-h-10 w-full rounded-2xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-100" /></label>
                </>
              )}
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800 sm:col-span-2"><input type="checkbox" checked={sshRemoveRecord} onChange={(event) => setSSHRemoveRecord(event.target.checked)} className="mt-1 h-4 w-4" />卸载后同时移除面板节点记录和历史数据</label>
              {sshUninstallMessage ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 sm:col-span-2">{sshUninstallMessage}</p> : null}
              {sshUninstallError ? <p className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 sm:col-span-2">{sshUninstallError}</p> : null}
              {sshUninstallEvents.length > 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-inner sm:col-span-2">
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500">卸载进度</p>
                  <ol className="space-y-2">
                    {sshUninstallEvents.map((event) => (
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
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              {sshUninstallEvents.some((event) => event.done) ? (
                <button type="button" onClick={() => setSSHUninstallOpen(false)} className="min-h-11 cursor-pointer rounded-2xl bg-white px-4 text-sm font-black text-slate-950 shadow-sm transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-emerald-100">
                  {sshUninstallEvents.some((event) => event.done && event.status === 'success') ? '完成并关闭' : '关闭'}
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => setSSHUninstallOpen(false)} disabled={sshUninstallLoading} className="min-h-11 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-500 transition hover:border-emerald-300 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60">取消</button>
                  <button type="button" onClick={startSSHUninstall} disabled={sshUninstallLoading} className="min-h-11 cursor-pointer rounded-2xl bg-red-600 px-4 text-sm font-black text-white shadow-sm transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-50">{sshUninstallLoading ? '正在创建卸载任务...' : '开始 SSH 卸载'}</button>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {editorOpen && fileRead?.editable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
          <div role="dialog" aria-modal="true" aria-label="编辑文件" className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-[28px] border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-500">正在编辑</p>
                <p className="mt-1 break-all text-sm font-black text-slate-950">{fileRead.path}</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setEditorOpen(false)} className="shrink-0 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 transition hover:text-slate-950">关闭</button>
            </div>
            {operationMessage ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">{operationMessage}</p> : null}
            <textarea autoFocus aria-label="文件内容" value={fileContent} onChange={(event) => setFileContent(event.target.value)} className="mt-3 min-h-[56vh] w-full resize-y rounded-2xl border border-slate-200 bg-slate-950 p-4 font-mono text-sm font-semibold leading-6 text-slate-100 outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={saveFile} className="min-h-11 rounded-2xl bg-emerald-500 px-4 text-sm font-black text-white shadow-sm transition hover:brightness-95">保存文件</button>
              <button type="button" onClick={() => setEditorOpen(false)} className="min-h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-500 transition hover:text-slate-950">关闭编辑器</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
    return <div className="m-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-black text-sky-700">正在加载进程 / Docker 快照...</div>
  }
  if (error) {
    return <div className="m-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">采集提示：{error}</div>
  }
  if (empty) {
    return <div className="m-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">{emptyText}</div>
  }
  return null
}

function ProcessTable({ processes }: { processes: ProcessInfo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-white text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="px-4 py-3">PID</th>
            <th className="px-4 py-3">名称</th>
            <th className="px-4 py-3">用户</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">CPU</th>
            <th className="px-4 py-3">内存</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {processes.map((process) => (
            <tr key={`${process.pid}-${process.name}`} className="align-top hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-xs font-black text-slate-950">{process.pid}</td>
              <td className="px-4 py-3 font-black text-slate-950">{process.name || 'unknown'}</td>
              <td className="px-4 py-3 font-semibold text-slate-500">{process.user || '—'}</td>
              <td className="px-4 py-3"><StatusPill value={process.status} /></td>
              <td className="px-4 py-3 font-black text-emerald-600">{formatPercent(process.cpu_usage)}</td>
              <td className="px-4 py-3 font-semibold text-slate-950">{formatBytes(process.memory_rss)} <span className="text-slate-500">({formatPercent(process.memory_usage)})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DockerTable({ nodeID, containers }: { nodeID: string, containers: DockerContainer[] }) {
  return (
    <div data-testid="docker-table-scroll" className="min-w-0 max-w-full overflow-x-auto">
      <table className="w-full min-w-0 table-fixed divide-y divide-slate-200 text-left text-sm">
        <thead className="bg-white text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="w-[22%] px-4 py-3">容器</th>
            <th className="w-[22%] px-4 py-3">镜像</th>
            <th className="w-[16%] px-4 py-3">状态</th>
            <th className="w-[9%] px-4 py-3">CPU</th>
            <th className="w-[16%] px-4 py-3">内存</th>
            <th className="hidden w-[15%] px-4 py-3 2xl:table-cell">网络</th>
            <th className="hidden w-[14%] px-4 py-3 2xl:table-cell">创建时间</th>
            <th className="w-[10%] px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {containers.map((container) => {
            const running = container.state.toLowerCase() === 'running'
            const execID = container.full_id || container.id
            return (
              <tr key={container.id} className="align-top hover:bg-slate-50">
                <td className="min-w-0 px-4 py-3"><p className="truncate font-black text-slate-950" title={container.name || container.id}>{container.name || container.id}</p><p className="break-all font-mono text-xs font-bold text-slate-500" title={container.full_id || container.id}>{container.id}</p></td>
                <td className="min-w-0 px-4 py-3 font-semibold text-slate-500"><p className="line-clamp-2 break-all" title={container.image || '—'}>{container.image || '—'}</p></td>
                <td className="min-w-0 px-4 py-3"><StatusPill value={container.state || 'unknown'} detail={container.status} /></td>
                <td className="px-4 py-3 font-black text-cyan-600">{formatPercent(container.cpu_usage ?? 0)}</td>
                <td className="min-w-0 px-4 py-3 font-semibold text-slate-950"><p className="line-clamp-2 break-words" title={`${formatBytes(container.memory_usage ?? 0)}${container.memory_limit ? ` / ${formatBytes(container.memory_limit)} (${formatPercent(container.memory_percent ?? 0)})` : ''}`}>{formatBytes(container.memory_usage ?? 0)}{container.memory_limit ? <span className="text-slate-500"> / {formatBytes(container.memory_limit)} ({formatPercent(container.memory_percent ?? 0)})</span> : null}</p></td>
                <td className="hidden min-w-0 px-4 py-3 font-semibold text-slate-500 2xl:table-cell"><p className="truncate">↓ {formatBytes(container.network_rx ?? 0)} · ↑ {formatBytes(container.network_tx ?? 0)}</p></td>
                <td className="hidden px-4 py-3 font-semibold text-slate-500 2xl:table-cell">{formatUnixTime(container.created_at)}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    aria-label={running ? `进入容器 ${container.name || container.id}` : `容器 ${container.name || container.id} 未运行，不能 exec`}
                    title={running ? '进入容器 exec' : '容器未运行，不能 exec'}
                    disabled={!running}
                    onClick={() => openContainerExecPage(nodeID, execID)}
                    className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-emerald-500 text-white transition hover:-translate-y-0.5 hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 disabled:hover:translate-y-0"
                  >
                    <TerminalIcon />
                  </button>
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
    ? 'bg-emerald-50 text-emerald-700 ring-success/20'
    : normalized.includes('exit') || normalized.includes('stop')
      ? 'bg-slate-100 text-slate-500 ring-slate-200'
      : normalized.includes('restart') || normalized.includes('zombie')
        ? 'bg-amber-50 text-amber-800 ring-warning/20'
        : 'bg-sky-50 text-sky-700 ring-info/20'
  return (
    <span className={`inline-flex max-w-[220px] flex-col rounded-2xl px-3 py-1 text-xs font-black ring-1 ${className}`}>
      <span>{value || 'unknown'}</span>
      {detail ? <span className="mt-0.5 truncate font-semibold opacity-75">{detail}</span> : null}
    </span>
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

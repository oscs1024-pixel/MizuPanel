import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createInstallCommand, getNodeMetrics, getNodes } from './api/client'
import { MetricCard } from './components/MetricCard'
import { NodeDetail } from './pages/NodeDetail'
import { NodeList } from './pages/NodeList'
import type { Metric, Node, RangeOption } from './types'

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

type HostFilter = 'all' | 'online' | 'offline'

export default function App() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [selectedNodeID, setSelectedNodeID] = useState<string>()
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [range, setRange] = useState<RangeOption>('1h')
  const [error, setError] = useState<string>()
  const [search, setSearch] = useState('')
  const [hostFilter, setHostFilter] = useState<HostFilter>('all')
  const [installCommand, setInstallCommand] = useState<string>()
  const [installCommandWarning, setInstallCommandWarning] = useState<string>()
  const [installCommandCopied, setInstallCommandCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const addHostButtonRef = useRef<HTMLButtonElement>(null)
  const installCommandCodeRef = useRef<HTMLElement>(null)

  const loadNodes = useCallback(() => {
    const pathMatch = window.location.pathname.match(/^\/nodes\/([^/]+)$/)
    return getNodes()
      .then((response) => {
        setNodes(response.nodes)
        const routeNodeID = decodeRouteNodeID(pathMatch?.[1])
        const routeNodeExists = routeNodeID ? response.nodes.some((node) => node.id === routeNodeID) : false
        setSelectedNodeID((current) => {
          if (current && response.nodes.some((node) => node.id === current)) return current
          return routeNodeExists ? routeNodeID : response.nodes[0]?.id
        })
      })
  }, [])

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
    if (selectedNodeID && window.location.pathname !== nodePath(selectedNodeID)) {
      window.history.replaceState({}, '', nodePath(selectedNodeID))
    }
  }, [selectedNodeID])

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

  useEffect(() => {
    if (filteredNodes.length > 0 && !visibleSelectedNode) {
      setSelectedNodeID(filteredNodes[0].id)
    }
  }, [filteredNodes, visibleSelectedNode])

  const requestInstallCommand = () => {
    setInstallCommandWarning(undefined)
    setInstallCommandCopied(false)
    return createInstallCommand().then((response) => setInstallCommand(response.command))
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

  const hostFilterButtonClass = (filter: HostFilter, activeClass: string, inactiveClass: string) => (
    `min-h-10 cursor-pointer rounded-2xl px-4 text-sm font-black transition focus:outline-none focus:ring-4 ${hostFilter === filter ? activeClass : inactiveClass}`
  )

  const showInstallCommand = () => {
    if (installCommand) return
    requestInstallCommand()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '安装命令生成失败'))
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f2f4f7] px-4 text-slate-950">
        <div className="rounded-[28px] border border-white/80 bg-white px-6 py-5 text-sm font-black text-slate-500 shadow-glass">正在加载节点...</div>
      </main>
    )
  }

  const installCommandPanel = installCommand ? (
    <div
      id="agent-install-command"
      role="region"
      aria-label="Agent 安装命令"
      aria-live="polite"
      className="mx-auto mt-5 max-w-4xl overflow-hidden rounded-[26px] border border-slate-200 bg-white text-left shadow-sm"
    >
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-slate-950">Agent 安装命令</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">复制命令到目标服务器执行；install_token 会在点击添加主机时自动生成。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            aria-label={installCommandCopied ? '已复制' : '复制安装命令'}
            onClick={copyInstallCommand}
            className="min-h-10 cursor-pointer rounded-2xl bg-blue-600 px-4 text-xs font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            {installCommandCopied ? '已复制' : '复制'}
          </button>
          <button
            type="button"
            aria-label="关闭安装命令"
            onClick={() => {
              setInstallCommand(undefined)
              setInstallCommandWarning(undefined)
              setInstallCommandCopied(false)
              addHostButtonRef.current?.focus()
            }}
            className="min-h-10 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            关闭
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100"><code ref={installCommandCodeRef}>{installCommand}</code></pre>
      {installCommandWarning ? (
        <div className="border-t border-orange-200 bg-orange-50 px-4 py-3 text-xs font-bold leading-5 text-orange-800">
          {installCommandWarning}
        </div>
      ) : null}
      <div className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
        token 来源：点击添加主机时，Server 会自动生成一次性 install_token。
      </div>
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
              {['主机列表', '历史记录', 'Docker', '后台管理'].map((item, index) => (
                <button
                  key={item}
                  type="button"
                  className={`min-h-11 cursor-pointer rounded-2xl px-4 text-sm font-extrabold transition focus:outline-none focus:ring-4 focus:ring-blue-200 ${
                    index === 0 ? 'bg-slate-950 text-white shadow-lg shadow-slate-300/70' : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950'
                  }`}
                >
                  {item}
                </button>
              ))}
              <button
                type="button"
                className="min-h-11 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-600 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-blue-200"
              >
                终端
              </button>
            </nav>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 font-semibold text-red-700 shadow-sm">{error}</div> : null}


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
              aria-expanded={Boolean(installCommand)}
              aria-controls="agent-install-command"
              className="mt-6 min-h-11 cursor-pointer rounded-2xl bg-slate-950 px-5 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-blue-100"
            >
              安装目标主机 Agent 进行采集
            </button>
            {installCommandPanel}
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
                  aria-expanded={Boolean(installCommand)}
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

            {installCommandPanel}

            <div className="grid gap-3 xl:grid-cols-[0.76fr_1.24fr]">
              {filteredNodes.length > 0 ? (
                <NodeList nodes={filteredNodes} selectedNodeID={selectedNodeID} onSelectNode={(node) => setSelectedNodeID(node.id)} />
              ) : (
                <section className="rounded-[26px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                  <p className="font-display text-2xl font-black text-slate-950">未找到匹配主机</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">请调整在线状态筛选或搜索关键词。</p>
                </section>
              )}
              <NodeDetail node={visibleSelectedNode} metrics={metrics} range={range} onRangeChange={setRange} />
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'

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

export default function App() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [selectedNodeID, setSelectedNodeID] = useState<string>()
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [range, setRange] = useState<RangeOption>('1h')
  const [error, setError] = useState<string>()
  const [search, setSearch] = useState('')
  const [installCommand, setInstallCommand] = useState<string>()
  const [installCommandWarning, setInstallCommandWarning] = useState<string>()
  const addHostButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    const pathMatch = window.location.pathname.match(/^\/nodes\/([^/]+)$/)
    getNodes()
      .then((response) => {
        if (cancelled) return
        setNodes(response.nodes)
        const routeNodeID = decodeRouteNodeID(pathMatch?.[1])
        const routeNodeExists = routeNodeID ? response.nodes.some((node) => node.id === routeNodeID) : false
        setSelectedNodeID((current) => {
          if (current && response.nodes.some((node) => node.id === current)) return current
          return routeNodeExists ? routeNodeID : response.nodes[0]?.id
        })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '节点加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeID), [nodes, selectedNodeID])

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
    if (!keyword) return nodes
    return nodes.filter((node) => [node.name, node.hostname, node.ip, node.os, node.arch].some((value) => value.toLowerCase().includes(keyword)))
  }, [nodes, search])

  const showInstallCommand = () => {
    if (installCommand) return
    setInstallCommandWarning(undefined)
    createInstallCommand()
      .then((response) => setInstallCommand(response.command))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : '安装命令生成失败'))
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
          <p className="mt-1 text-xs font-semibold text-slate-500">复制命令到目标服务器执行；install_token 后续会由登录后的添加主机接口自动生成。</p>
        </div>
        <button
          type="button"
          aria-label="关闭安装命令"
          onClick={() => {
            setInstallCommand(undefined)
            setInstallCommandWarning(undefined)
            addHostButtonRef.current?.focus()
          }}
          className="min-h-10 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 transition hover:border-slate-300 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-blue-100"
        >
          关闭
        </button>
      </div>
      <pre className="overflow-x-auto bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100"><code>{installCommand}</code></pre>
      {installCommandWarning ? (
        <div className="border-t border-orange-200 bg-orange-50 px-4 py-3 text-xs font-bold leading-5 text-orange-800">
          {installCommandWarning}
        </div>
      ) : null}
      <div className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
        token 来源：登录后点击添加主机，Server 会自动生成一次性 install_token。
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
              {['主机列表', '历史记录', 'Docker', '后台管理', '终端'].map((item, index) => (
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
                <button type="button" className="min-h-10 cursor-pointer rounded-2xl bg-slate-950 px-4 text-sm font-black text-white focus:outline-none focus:ring-4 focus:ring-blue-200">全部 {nodes.length}</button>
                <button type="button" className="min-h-10 cursor-pointer rounded-2xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-black text-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-100">在线 {onlineNodes}</button>
                <button type="button" className="min-h-10 cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-500 focus:outline-none focus:ring-4 focus:ring-slate-200">离线 {nodes.length - onlineNodes}</button>
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
              <NodeList nodes={filteredNodes} selectedNodeID={selectedNodeID} onSelectNode={(node) => setSelectedNodeID(node.id)} />
              <NodeDetail node={selectedNode} metrics={metrics} range={range} onRangeChange={setRange} />
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

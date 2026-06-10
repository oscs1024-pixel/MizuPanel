import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import App from './App'
import { createInstallCommand, startSSHInstall } from './api/client'

const eventSources: FakeEventSource[] = []

class FakeEventSource extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor(public url: string) {
    super()
    eventSources.push(this)
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
  close() {}
}

vi.mock('./api/client', () => ({
  getNodes: vi.fn(async () => ({
    nodes: [
      {
        id: 'node-1',
        name: 'Oracle SG',
        hostname: 'oracle-sg',
        ip: '10.0.0.1',
        os: 'linux',
        arch: 'arm64',
        kernel: '6.6',
        agent_version: '0.1.0',
        status: 'online',
        last_seen_at: '2026-05-24T10:00:00Z',
        latest_metric: {
          id: 1,
          node_id: 'node-1',
          cpu_usage: 12.5,
          cpu_cores: 4,
          memory_total: 1024,
          memory_used: 512,
          memory_usage: 50,
          disk_total: 2048,
          disk_used: 1024,
          disk_usage: 50,
          rx_speed: 100,
          tx_speed: 200,
          rx_total: 1000,
          tx_total: 2000,
          load1: 0.1,
          load5: 0.2,
          load15: 0.3,
          uptime: 90061,
          disk_read_speed: 4096,
          disk_write_speed: 8192,
          created_at: '2026-05-24T10:00:00Z'
        }
      }
    ]
  })),
  getNodeMetrics: vi.fn(async () => ({ metrics: [] })),
  getNodeProcesses: vi.fn(async () => ({ node_id: 'node-1', collected_at: 0, error: '', processes: [] })),
  getNodeDocker: vi.fn(async () => ({ node_id: 'node-1', collected_at: 0, available: false, error: '', containers: [] })),
  getSettings: vi.fn(async () => ({ metrics_retention: '6h', metrics_retention_seconds: 21600, max_metrics_retention: '7d' })),
  updateSettings: vi.fn(async () => ({ metrics_retention: '6h', metrics_retention_seconds: 21600, max_metrics_retention: '7d' })),
  createInstallCommand: vi.fn(async () => ({ command: 'curl install', install_token: 'install-token' })),
  getNodeFiles: vi.fn(async () => ({ path: '/', entries: [] })),
  readNodeFile: vi.fn(async () => ({ path: '/tmp/a', content: '', editable: true })),
  writeNodeFile: vi.fn(async () => ({ path: '/tmp/a', saved: true })),
  uploadNodeFile: vi.fn(async () => ({ path: '/tmp/upload.bin', uploaded: true })),
  deleteNodePath: vi.fn(async () => ({ path: '/tmp/upload.bin', deleted: true })),
  deleteNode: vi.fn(async () => undefined),
  rebootNode: vi.fn(async () => ({ accepted: true })),
  getAgentStatus: vi.fn(async () => ({ version: '0.1.0', user: 'root', mode: 'ops', terminal_enabled: true, docker_available: true, service_name: 'mizupanel-agent', uptime: 3600, collected_at: 1710000000 })),
  restartAgent: vi.fn(async () => ({ accepted: true, message: '重启命令已下发，等待 Agent 重新连接' })),
  getAgentLogs: vi.fn(async () => ({ lines: 100, content: 'mizupanel-agent started', collected_at: 1710000001 })),
  createTerminalSession: vi.fn(async () => ({ token: 'terminal-token' })),
  createContainerExecSession: vi.fn(async () => ({ token: 'exec-token' })),
  startSSHInstall: vi.fn(async () => ({ job_id: 'ssh-install-1' })),
  startSSHUninstall: vi.fn(async () => ({ job_id: 'ssh-uninstall-1' }))
}))

describe('App', () => {
  beforeEach(() => {
    eventSources.length = 0
    vi.clearAllMocks()
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  test('renders dashboard title and node card without authentication', async () => {
    render(<App />)

    expect(await screen.findByText('MizuPanel')).toBeInTheDocument()
    expect(screen.queryByText('MizuPanel Console')).not.toBeInTheDocument()
    expect(screen.queryByText('轻量级自托管服务器监控面板')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument()
    expect(await screen.findAllByText('Oracle SG')).toHaveLength(2)
    expect(screen.getByText('平均磁盘')).toBeInTheDocument()
    expect(screen.getByText('异常节点')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '登录 MizuPanel' })).not.toBeInTheDocument()
  })

  test('keeps manual command controls out of the SSH install tab and hides fixed install options', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '添加主机' }))
    expect(await screen.findByRole('dialog', { name: '添加主机' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SSH 自动安装' }))

    expect(screen.getByLabelText('SSH Host')).toBeInTheDocument()
    expect(screen.queryByLabelText('启用节点终端')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('启用 Docker 容器监控')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent 运行模式')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /普通模式/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /运维模式/ })).not.toBeInTheDocument()
    expect(screen.getByText('默认以 root 运维模式安装，自动启用节点终端与 Docker 容器监控。')).toBeInTheDocument()
    expect(screen.queryByLabelText('选择 Agent 安装系统')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制安装命令' })).not.toBeInTheDocument()
    expect(screen.queryByText('token 来源：点击添加主机时，Server 会自动生成一次性 install_token。')).not.toBeInTheDocument()
    expect(screen.queryByText('简化状态')).not.toBeInTheDocument()
  })

  test('does not create manual install tokens while using the SSH install tab', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '添加主机' }))
    expect(await screen.findByRole('dialog', { name: '添加主机' })).toBeInTheDocument()
    await waitFor(() => expect(createInstallCommand).not.toHaveBeenCalled())

    expect(screen.queryByLabelText('启用 Docker 容器监控')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('启用节点终端')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /运维模式/ })).not.toBeInTheDocument()
    expect(createInstallCommand).not.toHaveBeenCalled()
  })

  test('clears one-time SSH credentials when the add host dialog closes', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '添加主机' }))
    fireEvent.change(await screen.findByLabelText('SSH Host'), { target: { value: '192.168.1.10' } })
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('节点 ID'), { target: { value: 'node-ssh' } })
    fireEvent.click(screen.getByRole('button', { name: '关闭添加主机' }))

    fireEvent.click(await screen.findByRole('button', { name: '添加主机' }))

    expect(screen.getByLabelText('SSH Host')).toHaveValue('')
    expect(screen.getByLabelText('SSH 密码')).toHaveValue('')
    expect(screen.getByLabelText('节点 ID')).toHaveValue('')
  })

  test('shows simplified manual install status in the manual command tab', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '添加主机' }))
    fireEvent.click(await screen.findByRole('button', { name: '手动命令安装' }))

    await waitFor(() => expect(createInstallCommand).toHaveBeenCalled())
    expect(await screen.findByText('已生成一次性 install_token')).toBeInTheDocument()
    expect(screen.getByText('等待在目标机器执行命令')).toBeInTheDocument()
    expect(screen.getByText('等待 Agent 首次注册')).toBeInTheDocument()
    expect(screen.getByText(/超时未连接时，请检查 server_url、防火墙或 Agent 日志/)).toBeInTheDocument()
    expect(screen.queryByLabelText('SSH Host')).not.toBeInTheDocument()
  })

  test('groups SSH install step logs and closes from the bottom after completion', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '添加主机' }))
    fireEvent.click(screen.getByRole('button', { name: 'SSH 自动安装' }))
    fireEvent.change(screen.getByLabelText('SSH Host'), { target: { value: '192.168.1.10' } })
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('节点 ID'), { target: { value: 'node-ssh' } })
    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: 'SSH Node' } })
    fireEvent.click(screen.getByRole('button', { name: '开始 SSH 安装' }))

    await waitFor(() => expect(startSSHInstall).toHaveBeenCalled())
    act(() => {
      eventSources[0].emit({ step: 'connect_ssh', label: '连接 SSH', status: 'running', message: '正在连接 root@192.168.1.10:22' })
      eventSources[0].emit({ step: 'connect_ssh', label: '连接 SSH', status: 'success', message: 'SSH 已连接' })
      eventSources[0].emit({ step: 'done', label: '完成', status: 'success', message: '任务已完成', done: true })
    })

    await waitFor(() => expect(screen.getByText('SSH 已连接')).toBeInTheDocument())
    expect(screen.getByText('正在连接 root@192.168.1.10:22')).toBeInTheDocument()
    expect(screen.getAllByText('连接 SSH')).toHaveLength(1)
    expect(screen.getAllByText('成功').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '完成并关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加主机' })).not.toBeInTheDocument())
  })

  test('starts SSH root install from the add host dialog', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: '添加主机' }))
    expect(await screen.findByRole('dialog', { name: '添加主机' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'SSH 自动安装' }))
    fireEvent.change(screen.getByLabelText('SSH Host'), { target: { value: '192.168.1.10' } })
    fireEvent.change(screen.getByLabelText('SSH 密码'), { target: { value: 'secret' } })
    fireEvent.change(screen.getByLabelText('节点 ID'), { target: { value: 'node-ssh' } })
    fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: 'SSH Node' } })
    fireEvent.click(screen.getByRole('button', { name: '开始 SSH 安装' }))

    await waitFor(() => expect(startSSHInstall).toHaveBeenCalledWith(expect.objectContaining({
      host: '192.168.1.10',
      port: 22,
      username: 'root',
      auth_type: 'password',
      password: 'secret',
      node_id: 'node-ssh',
      name: 'SSH Node',
      enable_terminal: true,
      enable_docker: true,
      mode: 'ops'
    })))
    expect(await screen.findByText('SSH 安装任务已创建：ssh-install-1')).toBeInTheDocument()
    expect(eventSources[0]?.url).toBe('/api/install/ssh/ssh-install-1/events')
    eventSources[0].emit({ step: 'connect_ssh', label: '连接 SSH', status: 'success', message: 'SSH 已连接' })
    expect(await screen.findByText('连接 SSH')).toBeInTheDocument()
    expect(screen.getByText('SSH 已连接')).toBeInTheDocument()
  })
})

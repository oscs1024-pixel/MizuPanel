import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import App from './App'

afterEach(() => {
  vi.unstubAllGlobals()
})

vi.mock('./api/client', () => ({
  createInstallCommand: vi.fn(async () => ({
    command: [
      `curl -fsSL 'http://localhost:8080/scripts/install-agent.sh' -o install-agent.sh \\`,
      `  && chmod +x install-agent.sh \\`,
      `  && sudo ./install-agent.sh \\`,
      `    --binary-base-url 'http://localhost:8080/downloads' \\`,
      `    --server-url 'ws://localhost:8080/api/agent/ws' \\`,
      `    --token 'generated-install-token' \\`,
      `    --node-id "$(hostname)" \\`,
      `    --name "$(hostname)"`
    ].join('\n'),
    install_token: 'generated-install-token'
  })),
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
          created_at: '2026-05-24T10:00:00Z'
        }
      }
    ]
  })),
  getNodeMetrics: vi.fn(async () => ({ metrics: [] }))}))

describe('reference-style dashboard layout', () => {
  test('renders compact host list navigation and expanded node detail', async () => {
    render(<App />)

    expect(await screen.findByRole('button', { name: '主机列表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '历史记录' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索主机...')).toBeInTheDocument()
    expect(screen.getByText('全部 1')).toBeInTheDocument()
    expect(screen.getByText('在线 1')).toBeInTheDocument()
    expect(screen.getByText('硬件概览')).toBeInTheDocument()
    expect(screen.getByText('负载趋势')).toBeInTheDocument()
    expect(screen.getByText('网络速率')).toBeInTheDocument()
  })

  test('reveals and closes the install command from the filter toolbar add host button', async () => {
    vi.stubGlobal('location', new URL('http://localhost:5173/nodes/node-1'))

    render(<App />)

    await screen.findByText('全部 1')
    const mainNavigation = screen.getByRole('navigation', { name: '主导航' })
    expect(within(mainNavigation).queryByRole('button', { name: '添加主机' })).not.toBeInTheDocument()

    const filterToolbar = screen.getByRole('toolbar', { name: '主机筛选与操作' })
    const addHostButton = within(filterToolbar).getByRole('button', { name: '添加主机' })
    expect(screen.queryByRole('region', { name: 'Agent 安装命令' })).not.toBeInTheDocument()

    fireEvent.click(addHostButton)

    const installRegion = await screen.findByRole('region', { name: 'Agent 安装命令' })
    expect(installRegion).toHaveTextContent("curl -fsSL 'http://localhost:8080/scripts/install-agent.sh'")
    expect(installRegion).toHaveTextContent("--binary-base-url 'http://localhost:8080/downloads'")
    expect(installRegion).toHaveTextContent("--server-url 'ws://localhost:8080/api/agent/ws'")
    expect(installRegion).toHaveTextContent("--token 'generated-install-token'")
    expect(screen.getByText('token 来源：登录后点击添加主机，Server 会自动生成一次性 install_token。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭安装命令' }))

    expect(screen.queryByRole('region', { name: 'Agent 安装命令' })).not.toBeInTheDocument()
    expect(addHostButton).toHaveFocus()
  })
})

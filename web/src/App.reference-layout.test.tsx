import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import App from './App'

const { createInstallCommandMock } = vi.hoisted(() => ({
  createInstallCommandMock: vi.fn(async () => ({
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
  }))
}))

vi.mock('./api/client', () => ({
  createInstallCommand: createInstallCommandMock,
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
      },
      {
        id: 'node-2',
        name: 'Tokyo Backup',
        hostname: 'tokyo-backup',
        ip: '10.0.0.2',
        os: 'linux',
        arch: 'amd64',
        kernel: '5.15',
        agent_version: '0.1.0',
        status: 'offline',
        last_seen_at: '2026-05-24T09:00:00Z'
      }
    ]
  })),
  getNodeMetrics: vi.fn(async () => ({ metrics: [] }))
}))

afterEach(() => {
  vi.unstubAllGlobals()
  createInstallCommandMock.mockClear()
})

describe('reference-style dashboard layout', () => {
  test('renders compact host list navigation and expanded node detail without auth controls', async () => {
    render(<App />)

    expect(await screen.findByRole('button', { name: '主机列表' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '历史记录' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('搜索主机...')).toBeInTheDocument()
    expect(screen.getByText('全部 2')).toBeInTheDocument()
    expect(screen.getByText('在线 1')).toBeInTheDocument()
    expect(screen.getByText('硬件概览')).toBeInTheDocument()
    expect(screen.getByText('负载趋势')).toBeInTheDocument()
    expect(screen.getByText('网络速率')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '登录 MizuPanel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument()
  })

  test('filters hosts by status and search keyword', async () => {
    render(<App />)

    await screen.findByText('全部 2')
    expect(screen.getByRole('button', { name: '全部 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Oracle SG/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tokyo Backup/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '离线 1' }))

    expect(screen.getByRole('button', { name: '离线 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Oracle SG/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tokyo Backup/ })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Tokyo Backup' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Oracle SG' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('搜索主机...'), { target: { value: 'oracle' } })

    expect(screen.queryByRole('button', { name: /Tokyo Backup/ })).not.toBeInTheDocument()
    expect(screen.getByText('未找到匹配主机')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tokyo Backup' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '在线 1' }))

    expect(screen.getByRole('button', { name: '在线 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Oracle SG/ })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Oracle SG' })).toBeInTheDocument()
    expect(screen.queryByText('未找到匹配主机')).not.toBeInTheDocument()
  })

  test('reveals, copies, and closes the install command from the filter toolbar add host button', async () => {
    vi.stubGlobal('location', new URL('http://localhost:5173/nodes/node-1'))
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<App />)

    await screen.findByText('全部 2')
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
    expect(screen.getByText('token 来源：点击添加主机时，Server 会自动生成一次性 install_token。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '复制安装命令' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("--token 'generated-install-token'")))
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭安装命令' }))

    expect(screen.queryByRole('region', { name: 'Agent 安装命令' })).not.toBeInTheDocument()
    expect(addHostButton).toHaveFocus()
  })

  test('copies with the selected text fallback when clipboard is unavailable', async () => {
    vi.stubGlobal('location', new URL('http://localhost:5173/nodes/node-1'))
    vi.stubGlobal('navigator', {})
    const execCommand = vi.fn(() => true)
    Object.assign(document, { execCommand })

    render(<App />)

    await screen.findByText('全部 2')
    fireEvent.click(screen.getByRole('button', { name: '添加主机' }))
    await screen.findByRole('region', { name: 'Agent 安装命令' })

    fireEvent.click(screen.getByRole('button', { name: '复制安装命令' }))

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'))
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument()
    expect(window.getSelection()?.toString()).toContain("--token 'generated-install-token'")
  })

  test('shows a manual copy warning when all copy paths fail', async () => {
    vi.stubGlobal('location', new URL('http://localhost:5173/nodes/node-1'))
    vi.stubGlobal('navigator', {})
    Object.assign(document, { execCommand: vi.fn(() => false) })

    render(<App />)

    await screen.findByText('全部 2')
    fireEvent.click(screen.getByRole('button', { name: '添加主机' }))
    await screen.findByRole('region', { name: 'Agent 安装命令' })

    fireEvent.click(screen.getByRole('button', { name: '复制安装命令' }))

    expect(await screen.findByText('复制失败，已为你选中命令，请按 Ctrl+C 手动复制。')).toBeInTheDocument()
    expect(window.getSelection()?.toString()).toContain("--token 'generated-install-token'")
  })
})

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import App from './App'
import { getNodeDocker, getNodeMetrics, getNodeProcesses, getNodes } from './api/client'
import type { DockerSnapshotResponse, MetricsResponse, NodesResponse, ProcessSnapshotResponse } from './types'

vi.mock('./api/client', () => ({
  createInstallCommand: vi.fn(async () => ({ command: 'install', install_token: 'token' })),
  getNodes: vi.fn(),
  getNodeMetrics: vi.fn(),
  getNodeProcesses: vi.fn(),
  getNodeDocker: vi.fn(),
  getSettings: vi.fn(async () => ({ metrics_retention: '6h', metrics_retention_seconds: 21600, max_metrics_retention: '7d' })),
  updateSettings: vi.fn(async () => ({ metrics_retention: '6h', metrics_retention_seconds: 21600, max_metrics_retention: '7d' })),
  getNodeFiles: vi.fn(async () => ({ path: '/', entries: [] })),
  readNodeFile: vi.fn(async () => ({ path: '/tmp/a', content: '', editable: true })),
  writeNodeFile: vi.fn(async () => ({ path: '/tmp/a', saved: true })),
  uploadNodeFile: vi.fn(async () => ({ path: '/tmp/upload.bin', uploaded: true })),
  deleteNodePath: vi.fn(async () => ({ path: '/tmp/upload.bin', deleted: true })),
  deleteNode: vi.fn(async () => undefined),
  rebootNode: vi.fn(async () => ({ accepted: true })),
  createTerminalSession: vi.fn(async () => ({ token: 'terminal-token' })),
  createContainerExecSession: vi.fn(async () => ({ token: 'exec-token' }))
}))

const nodesResponse: NodesResponse = {
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
      last_seen_at: '2026-05-24T10:00:00Z'
    },
    {
      id: 'node-2',
      name: 'Tokyo JP',
      hostname: 'tokyo-jp',
      ip: '10.0.0.2',
      os: 'linux',
      arch: 'amd64',
      kernel: '6.6',
      agent_version: '0.1.0',
      status: 'online',
      last_seen_at: '2026-05-24T10:00:00Z'
    }
  ]
}

const emptyMetrics: MetricsResponse = { metrics: [] }

const processSnapshot: ProcessSnapshotResponse = {
  node_id: 'node-1',
  collected_at: 1710000000,
  error: '',
  processes: [
    { pid: 101, ppid: 1, name: 'nginx', command: 'nginx -g daemon off', user: 'www-data', status: 'sleeping', cpu_usage: 8.5, memory_rss: 104857600, memory_usage: 5.5 },
    { pid: 202, ppid: 1, name: 'postgres', command: 'postgres --config', user: 'postgres', status: 'running', cpu_usage: 2, memory_rss: 2147483648, memory_usage: 40 }
  ]
}

const dockerSnapshot: DockerSnapshotResponse = {
  node_id: 'node-1',
  collected_at: 1710000001,
  available: true,
  version: '24.0.0',
  error: '',
  containers: [
    { id: 'abcdef123456', name: 'web', image: 'nginx:latest', state: 'running', status: 'Up 1 minute', cpu_usage: 3.5, memory_usage: 104857600, memory_limit: 1073741824, memory_percent: 9.8, network_rx: 1000, network_tx: 2000 },
    { id: 'deadbeef9999', name: 'worker', image: 'queue:latest', state: 'exited', status: 'Exited (0)', cpu_usage: 0, memory_usage: 0, memory_limit: 0, network_rx: 0, network_tx: 0 }
  ]
}

describe('node monitoring detail', () => {
  beforeEach(() => {
    vi.mocked(getNodes).mockReset()
    vi.mocked(getNodeMetrics).mockReset()
    vi.mocked(getNodeProcesses).mockReset()
    vi.mocked(getNodeDocker).mockReset()
    vi.mocked(getNodes).mockResolvedValue(nodesResponse)
    vi.mocked(getNodeMetrics).mockResolvedValue(emptyMetrics)
    vi.mocked(getNodeProcesses).mockResolvedValue(processSnapshot)
    vi.mocked(getNodeDocker).mockResolvedValue(dockerSnapshot)
  })

  test('loads snapshots and shows them behind detail section buttons', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Oracle SG' })).toBeInTheDocument()
    await waitFor(() => expect(getNodeProcesses).toHaveBeenCalledWith('node-1'))
    expect(getNodeDocker).toHaveBeenCalledWith('node-1')
    expect(screen.getByRole('button', { name: '机器基本信息' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('硬件概览')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '进程 Top' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Docker 容器' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '进程信息' }))
    expect(screen.getByRole('button', { name: '进程信息' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: '进程 Top' })).toHaveTextContent('nginx')
    expect(screen.getByRole('region', { name: '进程 Top' })).not.toHaveTextContent('nginx -g daemon off')
    expect(screen.queryByText('硬件概览')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '容器信息' }))
    expect(screen.getByRole('button', { name: '容器信息' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Docker 容器' })).toHaveTextContent('Docker 24.0.0')
    expect(screen.getByRole('region', { name: 'Docker 容器' })).toHaveTextContent('nginx:latest')
    expect(screen.queryByRole('region', { name: '进程 Top' })).not.toBeInTheDocument()
  })

  test('filters and sorts process rows locally', async () => {
    render(<App />)

    await screen.findByRole('heading', { name: 'Oracle SG' })
    fireEvent.click(screen.getByRole('button', { name: '进程信息' }))
    const processRegion = await screen.findByRole('region', { name: '进程 Top' })
    await waitFor(() => expect(processRegion).toHaveTextContent('postgres'))
    fireEvent.click(within(processRegion).getByRole('button', { name: '按内存排序' }))

    await waitFor(() => {
      const rows = within(processRegion).getAllByRole('row')
      expect(rows[1]).toHaveTextContent('postgres')
    })

    fireEvent.change(within(processRegion).getByLabelText('搜索进程'), { target: { value: 'nginx' } })

    await waitFor(() => {
      expect(within(processRegion).getByText('nginx')).toBeInTheDocument()
      expect(within(processRegion).queryByText('postgres')).not.toBeInTheDocument()
    })

    fireEvent.change(within(processRegion).getByLabelText('搜索进程'), { target: { value: 'not-found' } })

    expect(await within(processRegion).findByText('当前筛选条件下没有进程。')).toBeInTheDocument()
  })

  test('keeps Docker container table constrained inside the detail panel', async () => {
    vi.mocked(getNodeDocker).mockResolvedValueOnce({
      ...dockerSnapshot,
      containers: [{
        id: 'abcdef123456',
        full_id: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        name: 'very-long-container-name-that-should-not-stretch-the-whole-dashboard-layout',
        image: 'registry.example.com/namespace/very/very/very/long/image/name/that/used/to/stretch/the/page:latest',
        state: 'running',
        status: 'Up 1 minute with a very long docker status string that should stay clipped inside the table cell',
        cpu_usage: 3.5,
        memory_usage: 104857600,
        memory_limit: 1073741824,
        memory_percent: 9.8,
        network_rx: 1000,
        network_tx: 2000
      }]
    })

    render(<App />)

    await screen.findByRole('heading', { name: 'Oracle SG' })
    fireEvent.click(screen.getByRole('button', { name: '容器信息' }))
    const dockerRegion = await screen.findByRole('region', { name: 'Docker 容器' })
    const scrollArea = dockerRegion.querySelector('[data-testid="docker-table-scroll"]')
    const table = dockerRegion.querySelector('table')

    expect(scrollArea).toHaveClass('min-w-0', 'max-w-full', 'overflow-x-auto')
    expect(table).toHaveClass('w-full', 'min-w-0')
    expect(within(dockerRegion).getByTitle('registry.example.com/namespace/very/very/very/long/image/name/that/used/to/stretch/the/page:latest')).toHaveClass('line-clamp-2')
  })

  test('shows Docker unavailable and filters container status', async () => {
    vi.mocked(getNodeDocker).mockResolvedValueOnce({ node_id: 'node-1', collected_at: 1710000001, available: false, error: 'Get "http://docker/version": dial unix /var/run/docker.sock: connect: permission denied', containers: [] })

    render(<App />)

    await screen.findByRole('heading', { name: 'Oracle SG' })
    fireEvent.click(screen.getByRole('button', { name: '容器信息' }))
    const dockerRegion = await screen.findByRole('region', { name: 'Docker 容器' })
    await waitFor(() => expect(dockerRegion).toHaveTextContent('Agent 当前用户没有权限访问 Docker'))

    vi.mocked(getNodeDocker).mockResolvedValue(dockerSnapshot)
    fireEvent.click(screen.getByRole('button', { name: /Tokyo JP/ }))
    await waitFor(() => expect(getNodeDocker).toHaveBeenCalledWith('node-2'))
    const refreshedDockerRegion = screen.getByRole('region', { name: 'Docker 容器' })
    expect(within(refreshedDockerRegion).getByLabelText('搜索容器')).toBeInTheDocument()
    fireEvent.click(within(refreshedDockerRegion).getByRole('button', { name: '运行中' }))

    expect(refreshedDockerRegion).toHaveTextContent('web')
    expect(refreshedDockerRegion).not.toHaveTextContent('worker')
  })
})

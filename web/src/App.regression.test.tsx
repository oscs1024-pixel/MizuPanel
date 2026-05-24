import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import App from './App'
import { getNodeMetrics, getNodes } from './api/client'
import type { Metric, Node } from './types'

vi.mock('./api/client', () => ({
  getNodes: vi.fn(),
  getNodeMetrics: vi.fn()}))

const nodes: Node[] = [
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

const metric: Metric = {
  id: 1,
  node_id: 'node-1',
  cpu_usage: 72,
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

describe('App regression behavior', () => {
  test('falls back to the first node when the route node id is invalid', async () => {
    window.history.pushState({}, '', '/nodes/missing-node')
    vi.mocked(getNodes).mockResolvedValueOnce({ nodes })
    vi.mocked(getNodeMetrics).mockResolvedValue({ metrics: [] })

    render(<App />)

    expect(await screen.findAllByText('Oracle SG')).toHaveLength(2)
    await waitFor(() => expect(window.location.pathname).toBe('/nodes/node-1'))
  })

  test('clears previous chart metrics while loading a newly selected node', async () => {
    vi.mocked(getNodes).mockResolvedValueOnce({ nodes })
    vi.mocked(getNodeMetrics)
      .mockResolvedValueOnce({ metrics: [metric] })
      .mockReturnValueOnce(new Promise(() => {}))

    render(<App />)

    expect(await screen.findAllByText('Oracle SG')).toHaveLength(2)
    await waitFor(() => expect(screen.queryAllByText('等待指标数据')).toHaveLength(0))

    fireEvent.click(screen.getByRole('button', { name: /Tokyo JP/ }))

    expect(await screen.findAllByText('Tokyo JP')).toHaveLength(2)
    expect(screen.getAllByText('等待指标数据').length).toBeGreaterThan(0)
  })

  test('restores encoded route node ids without falling back to the first node', async () => {
    const encodedRouteNodes: Node[] = [
      nodes[0],
      {
        ...nodes[1],
        id: '节点 2',
        name: '北京 CN'
      }
    ]
    window.history.pushState({}, '', `/nodes/${encodeURIComponent('节点 2')}`)
    vi.mocked(getNodes).mockResolvedValueOnce({ nodes: encodedRouteNodes })
    vi.mocked(getNodeMetrics).mockResolvedValue({ metrics: [] })

    render(<App />)

    expect(await screen.findAllByText('北京 CN')).toHaveLength(2)
    await waitFor(() => expect(getNodeMetrics).toHaveBeenCalledWith('节点 2', '1h'))
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import App from './App'

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
          created_at: '2026-05-24T10:00:00Z'
        }
      }
    ]
  })),
  getNodeMetrics: vi.fn(async () => ({ metrics: [] }))
}))

describe('App', () => {
  test('renders dashboard title and node card without authentication', async () => {
    render(<App />)

    expect(await screen.findByText('MizuPanel')).toBeInTheDocument()
    expect(screen.getByText('轻量级自托管服务器监控面板')).toBeInTheDocument()
    expect(await screen.findAllByText('Oracle SG')).toHaveLength(2)
    expect(screen.getByText('在线节点')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '登录 MizuPanel' })).not.toBeInTheDocument()
  })
})

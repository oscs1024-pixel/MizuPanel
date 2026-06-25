import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { NodeDetail } from './NodeDetail'
import type { Node, ProcessInfo } from '../types'

const node: Node = {
  id: 'node-1',
  name: 'master',
  hostname: 'master',
  ip: '192.168.98.10',
  os: 'linux',
  arch: 'amd64',
  kernel: '6.6',
  agent_version: '0.1.0',
  status: 'online',
  last_seen_at: '2026-06-25T10:00:00Z',
  terminal_enabled: true,
  agent_mode: 'ops',
  agent_user: 'root'
}

const sleepProcess: ProcessInfo = {
  pid: 1234,
  ppid: 1,
  name: 'nginx',
  command: 'nginx: worker process',
  user: 'www-data',
  status: 'sleep',
  cpu_usage: 0.1,
  memory_rss: 1024 * 1024,
  memory_usage: 0.2,
  created_at: 1710000000
}

describe('NodeDetail process table', () => {
  test('keeps simple process status pills compact', () => {
    render(
      <NodeDetail
        node={node}
        metrics={[]}
        processSnapshot={{ node_id: 'node-1', collected_at: 1710000001, error: '', processes: [sleepProcess] }}
        dockerSnapshot={{ node_id: 'node-1', collected_at: 1710000001, available: false, error: '', containers: [] }}
        range="1h"
        onRangeChange={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '进程信息' }))

    const statusText = screen.getByText('sleep')
    const statusPill = statusText.parentElement
    expect(statusPill).toHaveClass('w-fit')
    expect(statusPill).not.toHaveClass('w-full')
  })
})

import { render, screen, waitFor } from '@testing-library/react'
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
        last_seen_at: '2026-05-24T10:00:00Z'
      }
    ]
  })),
  getNodeMetrics: vi.fn(async () => ({ metrics: [] })),
  getNodeProcesses: vi.fn(async () => ({ node_id: 'node-1', collected_at: 0, error: '', processes: [] })),
  getNodeDocker: vi.fn(async () => ({ node_id: 'node-1', collected_at: 0, available: false, error: '', containers: [] })),
  getSettings: vi.fn(async () => ({ metrics_retention: '6h', metrics_retention_seconds: 21600, max_metrics_retention: '7d' })),
  updateSettings: vi.fn(async () => ({ metrics_retention: '6h', metrics_retention_seconds: 21600, max_metrics_retention: '7d' })),
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

describe('App routing', () => {
  test('uses /nodes/:id as the selected node path', async () => {
    window.history.pushState({}, '', '/nodes/node-1')

    render(<App />)

    expect(await screen.findAllByText('Oracle SG')).toHaveLength(2)
    await waitFor(() => expect(window.location.pathname).toBe('/nodes/node-1'))
  })
})

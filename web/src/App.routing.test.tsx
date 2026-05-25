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
  getNodeMetrics: vi.fn(async () => ({ metrics: [] }))
}))

describe('App routing', () => {
  test('uses /nodes/:id as the selected node path', async () => {
    window.history.pushState({}, '', '/nodes/node-1')

    render(<App />)

    expect(await screen.findAllByText('Oracle SG')).toHaveLength(2)
    await waitFor(() => expect(window.location.pathname).toBe('/nodes/node-1'))
  })
})

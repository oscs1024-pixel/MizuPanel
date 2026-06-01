import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { TerminalPage } from './TerminalPage'
import { createTerminalSession } from '../api/client'

vi.mock('../api/client', () => ({
  createTerminalSession: vi.fn(async () => ({ token: 'terminal-token' })),
  createContainerExecSession: vi.fn(async () => ({ token: 'exec-token' }))
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}))

const terminalWrites: string[] = []
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    write(value: string) { terminalWrites.push(value) }
    writeln(value: string) { terminalWrites.push(value) }
    onData() { return { dispose() {} } }
  }
}))

class FakeWebSocket extends EventTarget {
  static OPEN = 1
  readyState = FakeWebSocket.OPEN
  sent: string[] = []

  constructor(public url: string) {
    super()
    sockets.push(this)
  }

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.readyState = 3
  }
}

const sockets: FakeWebSocket[] = []

describe('TerminalPage', () => {
  beforeEach(() => {
    sockets.length = 0
    terminalWrites.length = 0
    vi.mocked(createTerminalSession).mockClear()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  test('explains that an Agent restart can close the terminal session', async () => {
    render(<TerminalPage kind="node" nodeID="node-1" node={{
      id: 'node-1',
      name: 'Oracle SG',
      hostname: 'oracle-sg',
      ip: '10.0.0.1',
      os: 'linux',
      arch: 'amd64',
      kernel: '6.6',
      agent_version: '0.1.0',
      status: 'online',
      last_seen_at: '2026-05-24T10:00:00Z',
      terminal_enabled: true
    }} />)

    await waitFor(() => expect(sockets).toHaveLength(1))

    act(() => {
      sockets[0].dispatchEvent(new Event('open'))
      sockets[0].dispatchEvent(new CloseEvent('close'))
    })

    expect(await screen.findByText('终端连接已关闭，Agent 可能已重启')).toBeInTheDocument()
    expect(terminalWrites.join('\n')).toContain('如果你刚刚在终端中重启或重装 Agent')
  })

  test('keeps the exit status when a finished terminal socket closes', async () => {
    render(<TerminalPage kind="node" nodeID="node-1" node={{
      id: 'node-1',
      name: 'Oracle SG',
      hostname: 'oracle-sg',
      ip: '10.0.0.1',
      os: 'linux',
      arch: 'amd64',
      kernel: '6.6',
      agent_version: '0.1.0',
      status: 'online',
      last_seen_at: '2026-05-24T10:00:00Z',
      terminal_enabled: true
    }} />)

    await waitFor(() => expect(sockets).toHaveLength(1))

    act(() => {
      sockets[0].dispatchEvent(new Event('open'))
      sockets[0].dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'terminal_exit', exit_code: 0 }) }))
      sockets[0].dispatchEvent(new CloseEvent('close'))
    })

    expect(await screen.findByText('终端已退出，退出码 0')).toBeInTheDocument()
    expect(screen.queryByText('终端连接已关闭，Agent 可能已重启')).not.toBeInTheDocument()
  })
})

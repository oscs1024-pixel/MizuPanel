import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import App from './App'

vi.mock('./api/client', () => ({
  createInstallCommand: vi.fn(async () => ({
    command: [
      `curl -fsSL 'http://panel.example:8080/scripts/install-agent.sh' -o install-agent.sh \\`,
      `  && chmod +x install-agent.sh \\`,
      `  && sudo ./install-agent.sh \\`,
      `    --binary-base-url 'http://panel.example:8080/downloads' \\`,
      `    --server-url 'ws://panel.example:8080/api/agent/ws' \\`,
      `    --token 'generated-install-token' \\`,
      `    --node-id "$(hostname)" \\`,
      `    --name "$(hostname)"`
    ].join('\n'),
    install_token: 'generated-install-token'
  })),
  getNodes: vi.fn(async () => ({ nodes: [] })),
  getNodeMetrics: vi.fn(async () => ({ metrics: [] }))}))

describe('App empty state', () => {
  test('shows a button that reveals a generated install command when no nodes are registered', async () => {
    render(<App />)

    expect(await screen.findByText('暂无节点接入')).toBeInTheDocument()
    expect(screen.getByText('在目标服务器执行 Agent 安装命令后，节点会自动出现在这里。')).toBeInTheDocument()
    expect(screen.queryByText('curl -fsSL')).not.toBeInTheDocument()

    const installButton = screen.getByRole('button', { name: '安装目标主机 Agent 进行采集' })
    expect(installButton).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(installButton)

    expect(await screen.findByText(/ws:\/\/panel\.example:8080\/api\/agent\/ws/)).toBeInTheDocument()
    expect(installButton).toHaveAttribute('aria-expanded', 'true')
    const installRegion = screen.getByRole('region', { name: 'Agent 安装命令' })
    expect(installRegion).toHaveTextContent(/curl -fsSL 'http:\/\/panel\.example:8080\/scripts\/install-agent\.sh' -o install-agent\.sh \\\s+&& chmod \+x install-agent\.sh \\\s+&& sudo \.\/install-agent\.sh \\\s+--binary-base-url 'http:\/\/panel\.example:8080\/downloads' \\\s+--server-url 'ws:\/\/panel\.example:8080\/api\/agent\/ws' \\\s+--token 'generated-install-token'/)
    expect(screen.getByText('token 来源：登录后点击添加主机，Server 会自动生成一次性 install_token。')).toBeInTheDocument()
    expect(screen.queryByText('Select a node')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭安装命令' }))

    expect(screen.queryByRole('region', { name: 'Agent 安装命令' })).not.toBeInTheDocument()
    expect(installButton).toHaveFocus()
  })
})

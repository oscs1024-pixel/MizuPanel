import { afterEach, describe, expect, test, vi } from 'vitest'

import { createContainerExecSession, createInstallCommand, createTerminalSession, deleteNode, deleteNodePath, getNodeDocker, getNodeFiles, getNodeMetrics, getNodeProcesses, getNodes, getSettings, readNodeFile, rebootNode, updateSettings, uploadNodeFile, writeNodeFile } from './client'

describe('api client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('fetches nodes from the REST API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ nodes: [] })))

    const result = await getNodes()

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes')
    expect(result.nodes).toEqual([])
  })

  test('deletes node records with an empty response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))

    await deleteNode('node 1')

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes/node%201', { method: 'DELETE' })
  })

  test('fetches node metrics with a supported range', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ metrics: [] })))

    await getNodeMetrics('node-1', '7d')

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes/node-1/metrics?range=7d')
  })

  test('fetches and updates system settings', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ metrics_retention: '6h', metrics_retention_seconds: 21600, max_metrics_retention: '7d' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ metrics_retention: '24h', metrics_retention_seconds: 86400, max_metrics_retention: '7d' })))

    const current = await getSettings()
    const updated = await updateSettings({ metrics_retention: '24h' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/settings')
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metrics_retention: '24h' })
    })
    expect(current.metrics_retention).toBe('6h')
    expect(updated.metrics_retention).toBe('24h')
  })

  test('creates linux install commands without a session request header', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ command: 'install', install_token: 'token' })))

    const result = await createInstallCommand('linux')

    expect(fetchMock).toHaveBeenCalledWith('/api/install/command?platform=linux', { method: 'POST' })
    expect(result.command).toBe('install')
  })

  test('creates linux install commands with Docker opt-in', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ command: 'install --enable-docker', install_token: 'token' })))

    const result = await createInstallCommand('linux', { enableDocker: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/install/command?platform=linux&enable_docker=true', { method: 'POST' })
    expect(result.command).toBe('install --enable-docker')
  })

  test('creates linux install commands with ops mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ command: 'install --mode ops', install_token: 'token' })))

    const result = await createInstallCommand('linux', { mode: 'ops' })

    expect(fetchMock).toHaveBeenCalledWith('/api/install/command?platform=linux&mode=ops', { method: 'POST' })
    expect(result.command).toBe('install --mode ops')
  })

  test('creates linux install commands with terminal opt-in', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ command: 'install --enable-terminal', install_token: 'token' })))

    const result = await createInstallCommand('linux', { enableTerminal: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/install/command?platform=linux&enable_terminal=true', { method: 'POST' })
    expect(result.command).toBe('install --enable-terminal')
  })

  test('creates windows install commands', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ command: 'install-windows', install_token: 'token' })))

    const result = await createInstallCommand('windows')

    expect(fetchMock).toHaveBeenCalledWith('/api/install/command?platform=windows', { method: 'POST' })
    expect(result.command).toBe('install-windows')
  })

  test('does not send linux opt-ins for windows install commands', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ command: 'install-windows', install_token: 'token' })))

    await createInstallCommand('windows', { enableDocker: true, enableTerminal: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/install/command?platform=windows', { method: 'POST' })
  })

  test('fetches node process snapshots', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ node_id: 'node-1', collected_at: 0, error: '', processes: [] })))

    const result = await getNodeProcesses('node 1')

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes/node%201/processes')
    expect(result.processes).toEqual([])
  })

  test('fetches node Docker snapshots', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ node_id: 'node-1', collected_at: 0, available: false, error: '', containers: [] })))

    const result = await getNodeDocker('node 1')

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes/node%201/docker')
    expect(result.available).toBe(false)
  })

  test('fetches node files and mutates file content', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: '/etc', entries: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: '/etc/app.conf', content: 'a=1\n', editable: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: '/etc/app.conf', saved: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: '/etc/upload.bin', uploaded: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: '/etc/upload.bin', deleted: true })))

    await getNodeFiles('node 1', '/etc')
    await readNodeFile('node 1', '/etc/app.conf')
    await writeNodeFile('node 1', '/etc/app.conf', 'a=2\n')
    await uploadNodeFile('node 1', '/etc/upload.bin', 'AAEC')
    await deleteNodePath('node 1', '/etc/upload.bin')

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/nodes/node%201/files?path=%2Fetc')
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/nodes/node%201/files/content?path=%2Fetc%2Fapp.conf')
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/nodes/node%201/files/content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/etc/app.conf', content: 'a=2\n' })
    })
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/nodes/node%201/files/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/etc/upload.bin', content_base64: 'AAEC' })
    })
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/nodes/node%201/files/content', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/etc/upload.bin' })
    })
  })

  test('sends node reboot requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ accepted: true })))

    const result = await rebootNode('node 1')

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes/node%201/reboot', { method: 'POST' })
    expect(result.accepted).toBe(true)
  })

  test('creates terminal session tokens', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ token: 'terminal-token' })))

    const result = await createTerminalSession('node 1')

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes/node%201/terminal/session', { method: 'POST' })
    expect(result.token).toBe('terminal-token')
  })

  test('creates container exec session tokens', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ token: 'exec-token' })))

    const result = await createContainerExecSession('node 1', 'container/1')

    expect(fetchMock).toHaveBeenCalledWith('/api/nodes/node%201/containers/container%2F1/exec/session', { method: 'POST' })
    expect(result.token).toBe('exec-token')
  })

  test('marks unauthorized API responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }))

    await expect(createInstallCommand()).rejects.toMatchObject({ status: 401 })
  })

  test('throws when the API response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad', { status: 500 }))

    await expect(getNodes()).rejects.toThrow('Request failed')
  })
})
